import { loadPlayerId } from "./playerId";
import {
  MAX_TELEMETRY_EVENTS_PER_BATCH,
  MAX_TELEMETRY_QUEUE_SIZE,
  TELEMETRY_VERSION,
  bandAccuracy,
  bandChain,
  bandDuration,
  bandKpm,
  bandLevel,
  bandScore,
  coarseTelemetryPath,
  coarseTelemetrySource,
  createTelemetryBatchId,
  createTelemetryEvent,
  type TelemetryEntryPath,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryPropertiesMap,
  type TelemetrySource,
} from "./telemetryContract";

const ENDPOINT = "/api/telemetry";
const SESSION_ID_KEY = "typeburst.telemetry-session.v1";
const ATTRIBUTION_KEY = "typeburst.content-source.v1";
const ENABLED_KEY = "typeburst.telemetry-enabled.v1";
const ONCE_KEY_PREFIX = "typeburst.telemetry-once.v1:";
const FLUSH_INTERVAL_MS = 5_000;

let memorySessionId: string | null = null;
let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;
let sending = false;
const onceKeys = new Set<string>();

function randomId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // A short-lived fallback is sufficient for batching and deduplication.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function sessionId(): string {
  if (memorySessionId) return memorySessionId;
  const storage = typeof window === "undefined" ? undefined : window.sessionStorage;
  const existing = readStorage(storage, SESSION_ID_KEY);
  if (existing && existing.length >= 8 && existing.length <= 80) return (memorySessionId = existing);
  memorySessionId = randomId("session");
  try {
    storage?.setItem(SESSION_ID_KEY, memorySessionId);
  } catch {
    // Private browsing can reject storage. Memory fallback keeps gameplay intact.
  }
  return memorySessionId;
}

export function isBehaviorTelemetryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return readStorage(window.localStorage, ENABLED_KEY) !== "false";
}

export function setBehaviorTelemetryEnabled(enabled: boolean): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // The setting remains best-effort where localStorage is unavailable.
  }
  if (!enabled) {
    queue = [];
    onceKeys.clear();
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function currentAttribution(): { source: TelemetrySource; path: TelemetryEntryPath } {
  const rawSource =
    typeof window === "undefined" ? null : readStorage(window.sessionStorage, ATTRIBUTION_KEY);
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  return {
    source: coarseTelemetrySource(rawSource),
    path: coarseTelemetryPath(pathname),
  };
}

function requestBody(events: readonly TelemetryEvent[]): string {
  const body: Record<string, unknown> = {
    v: TELEMETRY_VERSION,
    batchId: createTelemetryBatchId(),
    sessionId: sessionId(),
    events,
  };
  // playerId is request metadata only. The server hashes it before storage and
  // never echoes or persists the raw value.
  try {
    body.playerId = loadPlayerId();
  } catch {
    // Session-level aggregates still work without persistent storage.
  }
  return JSON.stringify(body);
}

function installLifecycleListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  const flushForPageExit = (): void => {
    if (!isBehaviorTelemetryEnabled() || queue.length === 0) return;
    // The bounded queue can contain two server-sized batches. Drain both so a
    // quick play followed by tab close does not systematically lose tail events.
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_TELEMETRY_EVENTS_PER_BATCH);
      const body = requestBody(events);
      try {
        if (typeof navigator.sendBeacon === "function") {
          const accepted = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
          if (accepted) continue;
        }
      } catch {
        // Fall through to keepalive fetch.
      }
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => undefined);
    }
  };
  window.addEventListener("pagehide", flushForPageExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushForPageExit();
  });
}

function scheduleFlush(): void {
  if (flushTimer !== null || queue.length === 0 || !isBehaviorTelemetryEnabled()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBehaviorTelemetry();
  }, FLUSH_INTERVAL_MS);
}

/** Queue a strictly allow-listed event. Invalid and excessive data is dropped. */
export function trackBehaviorEvent<N extends TelemetryEventName>(
  name: N,
  properties: TelemetryPropertiesMap[N],
): void {
  if (!isBehaviorTelemetryEnabled()) return;
  const event = createTelemetryEvent(name, properties);
  if (!event) return;
  installLifecycleListeners();
  if (queue.length >= MAX_TELEMETRY_QUEUE_SIZE) queue.shift();
  queue.push(event as TelemetryEvent);
  if (queue.length >= MAX_TELEMETRY_EVENTS_PER_BATCH) void flushBehaviorTelemetry();
  else scheduleFlush();
}

/** Track a lifecycle milestone once for the supplied, non-sensitive key. */
export function trackBehaviorEventOnce<N extends TelemetryEventName>(
  dedupeKey: string,
  name: N,
  properties: TelemetryPropertiesMap[N],
): void {
  if (!dedupeKey || dedupeKey.length > 120 || onceKeys.has(dedupeKey)) return;
  const storageKey = `${ONCE_KEY_PREFIX}${dedupeKey}`;
  if (typeof window !== "undefined" && readStorage(window.sessionStorage, storageKey) === "1") return;
  onceKeys.add(dedupeKey);
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Memory dedupe still protects StrictMode when storage is unavailable.
  }
  trackBehaviorEvent(name, properties);
}

/** Flush without ever making a user-visible flow wait or fail. */
export async function flushBehaviorTelemetry(): Promise<void> {
  if (sending || !isBehaviorTelemetryEnabled() || queue.length === 0) return;
  sending = true;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  const events = queue.splice(0, MAX_TELEMETRY_EVENTS_PER_BATCH);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(events),
      keepalive: true,
      credentials: "same-origin",
    });
    // Rate limiting and server errors are deliberately not retried: telemetry
    // must never create traffic loops or affect the game.
    void response;
  } catch {
    // Best-effort only.
  } finally {
    sending = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/** Delete the HMAC-linked telemetry identity. Aggregate counters stay anonymous. */
export async function deleteTelemetryIdentity(): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: TELEMETRY_VERSION, playerId: loadPlayerId() }),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("telemetry_delete_failed");
  queue = [];
  onceKeys.clear();
}

export { bandAccuracy, bandChain, bandDuration, bandKpm, bandLevel, bandScore };
