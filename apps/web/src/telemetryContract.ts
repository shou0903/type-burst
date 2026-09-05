/**
 * First-party behavior telemetry contract.
 *
 * This module is deliberately independent from the Vercel Analytics wrapper.
 * Events are coarse, allow-listed and free of typed text, scores, player
 * names, URLs and other identifiers.  Keep this file in sync with the
 * `/api/telemetry` validator when the endpoint is changed.
 */

export const TELEMETRY_VERSION = 1 as const;
export const MAX_TELEMETRY_EVENTS_PER_BATCH = 10;
export const MAX_TELEMETRY_QUEUE_SIZE = 20;
export const MAX_TELEMETRY_EVENT_PROPERTIES = 12;

export type TelemetryPrimitive = string | number | boolean;

export type TelemetrySource =
  | "direct"
  | "google-organic"
  | "bing-organic"
  | "yahoo-organic"
  | "guide"
  | "social"
  | "share"
  | "newsletter"
  | "news"
  | "other";

export type TelemetryEntryPath = "home" | "about" | "guide" | "tool" | "romaji" | "other";

export type TelemetryMode = "survival" | "daily" | "duel" | "tutorial";
export type TelemetryDifficulty = "easy" | "normal" | "hard" | "god";
export type TelemetryScreen = "home" | "game" | "result" | "analysis" | "ranking" | "mobile_handoff";
export type TelemetryOutcome = "topped_out" | "time_limit" | "win" | "loss";
export type TelemetryContext = "home" | "result" | "growth" | "daily" | "duel" | "direct";
export type TelemetryEntryPoint =
  | "home"
  | "retry"
  | "analysis"
  | "daily"
  | "tutorial"
  | "onboarding"
  | "share";
export type TelemetryFocusGoal = "perfect-streak" | "chain-4" | "power-burst";

export type TelemetryEventName =
  | "content_entry"
  | "screen_view"
  | "game_start"
  | "game_finish"
  | "tutorial_completed"
  | "game_exit"
  | "result_action"
  | "share_action"
  | "ranking_action"
  | "analysis_action"
  | "settings_change"
  | "transfer_action"
  | "mobile_handoff"
  | "tool_action"
  | "feature_used"
  | "flow_failure";

export type RankingSurface = "world" | "daily";
export type RankingAction =
  | "open"
  | "difficulty_easy"
  | "difficulty_normal"
  | "difficulty_hard"
  | "difficulty_god"
  | "retry"
  | "submit_success"
  | "submit_error"
  | "skip";
export type ResultAction = "retry" | "analysis" | "title" | "ranking" | "share" | "back";
export type ShareAction = "open" | "x" | "line" | "save_image" | "copy_link" | "copy_text";
export type AnalysisScope = "result" | "growth" | "daily" | "duel";
export type AnalysisAction = "open" | "back" | "start";
export type TransferAction = "issue" | "lookup" | "restore" | "delete" | "copy";
export type TransferStatus = "started" | "success" | "error" | "cancel";
export type MobileHandoffAction = "share" | "copy" | "ranking" | "nav";
export type MobileAvailability = "native_share" | "copy_only";
export type TelemetryTool = "speed" | "sentence" | "weak_key" | "number_symbol" | "input_method" | "workload" | "romaji";
export type ToolAction = "start" | "complete" | "exit" | "run" | "lookup" | "practice" | "drill";
export type GameFeature = "burst" | "bomb" | "prism" | "chain" | "fever" | "clutch";
export type FailureSurface =
  | "fetch"
  | "render"
  | "share"
  | "transfer"
  | "ranking"
  | "analysis"
  | "game"
  | "mobile"
  | "telemetry"
  | "other";
export type FailureKind =
  | "network"
  | "invalid_response"
  | "timeout"
  | "unsupported"
  | "blocked"
  | "unknown";
export type SettingName = "sound" | "reduced_motion" | "high_contrast" | "font_scale";
export type SettingValue = "on" | "off" | "standard" | "large" | "xlarge";

/** Event-specific, low-cardinality property map. */
export interface TelemetryPropertiesMap {
  content_entry: {
    source: TelemetrySource;
    path: TelemetryEntryPath;
  };
  screen_view: {
    screen: TelemetryScreen;
    mode?: TelemetryMode;
    context?: TelemetryContext;
  };
  game_start: {
    mode: TelemetryMode;
    difficulty?: TelemetryDifficulty;
    entryPoint?: TelemetryEntryPoint;
    ranked?: boolean;
    firstPlay?: boolean;
    focusGoal?: TelemetryFocusGoal;
  };
  game_finish: {
    mode: TelemetryMode;
    outcome: TelemetryOutcome;
    difficulty?: TelemetryDifficulty;
    ranked?: boolean;
    scoreBand?: TelemetryStatBand;
    kpmBand?: TelemetryStatBand;
    accuracyBand?: TelemetryStatBand;
    chainBand?: TelemetryStatBand;
    durationBand?: TelemetryStatBand;
    levelBand?: TelemetryStatBand;
    focusAchieved?: boolean;
  };
  tutorial_completed: {
    firstPlay: boolean;
    source?: TelemetrySource;
  };
  game_exit: {
    mode: TelemetryMode;
    reason: "confirmed_quit";
    difficulty?: TelemetryDifficulty;
    elapsedBand?: TelemetryStatBand;
  };
  result_action: {
    mode: TelemetryMode;
    action: ResultAction;
  };
  share_action: {
    mode: TelemetryMode;
    action: ShareAction;
    status?: TransferStatus;
  };
  ranking_action: {
    surface: RankingSurface;
    action: RankingAction;
    difficulty?: TelemetryDifficulty;
    status?: TransferStatus;
  };
  analysis_action: {
    scope: AnalysisScope;
    action: AnalysisAction;
  };
  settings_change: {
    setting: SettingName;
    value: SettingValue;
  };
  transfer_action: {
    action: TransferAction;
    status: TransferStatus;
  };
  mobile_handoff: {
    action: MobileHandoffAction;
    availability?: MobileAvailability;
    status?: TransferStatus;
  };
  tool_action: {
    tool: TelemetryTool;
    action: ToolAction;
  };
  feature_used: {
    mode: TelemetryMode;
    feature: GameFeature;
  };
  flow_failure: {
    surface: FailureSurface;
    kind: FailureKind;
  };
}

export type TelemetryProperties = TelemetryPropertiesMap[TelemetryEventName];

export interface TelemetryEvent<N extends TelemetryEventName = TelemetryEventName> {
  eventId: string;
  name: N;
  properties: TelemetryPropertiesMap[N];
}

export interface TelemetryBatch {
  v: typeof TELEMETRY_VERSION;
  batchId: string;
  sessionId: string;
  /** Identity is request metadata only; it is never present in an event. */
  playerId?: string;
  events: readonly TelemetryEvent[];
}

const SOURCES: readonly TelemetrySource[] = [
  "direct",
  "google-organic",
  "bing-organic",
  "yahoo-organic",
  "guide",
  "social",
  "share",
  "newsletter",
  "news",
  "other",
];
const PATHS: readonly TelemetryEntryPath[] = ["home", "about", "guide", "tool", "romaji", "other"];
const MODES: readonly TelemetryMode[] = ["survival", "daily", "duel", "tutorial"];
const DIFFICULTIES: readonly TelemetryDifficulty[] = ["easy", "normal", "hard", "god"];
const SCREENS: readonly TelemetryScreen[] = ["home", "game", "result", "analysis", "ranking", "mobile_handoff"];
const OUTCOMES: readonly TelemetryOutcome[] = ["topped_out", "time_limit", "win", "loss"];
const CONTEXTS: readonly TelemetryContext[] = ["home", "result", "growth", "daily", "duel", "direct"];
const STAT_BANDS: readonly TelemetryStatBand[] = [
  "unknown", "0", "1-999", "1000-4999", "5000-9999", "10000-24999",
  "25000-49999", "50000+", "under-60", "60-119", "120-179", "180-239",
  "240+", "under-80", "80-89", "90-94", "95-97", "98-99", "100",
  "0-1", "2-3", "4-6", "7-9", "10+", "under-15s", "15-29s",
  "30-59s", "60-119s", "120s+", "1-4", "5-9", "10-19", "20-39", "40+",
];
const ENTRY_POINTS: readonly TelemetryEntryPoint[] = [
  "home",
  "retry",
  "analysis",
  "daily",
  "tutorial",
  "onboarding",
  "share",
];
const FOCUS_GOALS: readonly TelemetryFocusGoal[] = ["perfect-streak", "chain-4", "power-burst"];
const RANKING_SURFACES: readonly RankingSurface[] = ["world", "daily"];
const RANKING_ACTIONS: readonly RankingAction[] = [
  "open",
  "difficulty_easy",
  "difficulty_normal",
  "difficulty_hard",
  "difficulty_god",
  "retry",
  "submit_success",
  "submit_error",
  "skip",
];
const RESULT_ACTIONS: readonly ResultAction[] = ["retry", "analysis", "title", "ranking", "share", "back"];
const SHARE_ACTIONS: readonly ShareAction[] = ["open", "x", "line", "save_image", "copy_link", "copy_text"];
const ANALYSIS_SCOPES: readonly AnalysisScope[] = ["result", "growth", "daily", "duel"];
const ANALYSIS_ACTIONS: readonly AnalysisAction[] = ["open", "back", "start"];
const TRANSFER_ACTIONS: readonly TransferAction[] = ["issue", "lookup", "restore", "delete", "copy"];
const TRANSFER_STATUSES: readonly TransferStatus[] = ["started", "success", "error", "cancel"];
const MOBILE_ACTIONS: readonly MobileHandoffAction[] = ["share", "copy", "ranking", "nav"];
const MOBILE_AVAILABILITY: readonly MobileAvailability[] = ["native_share", "copy_only"];
const TOOLS: readonly TelemetryTool[] = ["speed", "sentence", "weak_key", "number_symbol", "input_method", "workload", "romaji"];
const TOOL_ACTIONS: readonly ToolAction[] = ["start", "complete", "exit", "run", "lookup", "practice", "drill"];
const FEATURES: readonly GameFeature[] = ["burst", "bomb", "prism", "chain", "fever", "clutch"];
const FAILURE_SURFACES: readonly FailureSurface[] = [
  "fetch",
  "render",
  "share",
  "transfer",
  "ranking",
  "analysis",
  "game",
  "mobile",
  "telemetry",
  "other",
];
const FAILURE_KINDS: readonly FailureKind[] = [
  "network",
  "invalid_response",
  "timeout",
  "unsupported",
  "blocked",
  "unknown",
];
const SETTINGS: readonly SettingName[] = ["sound", "reduced_motion", "high_contrast", "font_scale"];
const SETTING_VALUES: readonly SettingValue[] = ["on", "off", "standard", "large", "xlarge"];

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function inList<T extends string>(value: unknown, values: readonly T[]): value is T {
  return isString(value) && (values as readonly string[]).includes(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coarsen an attribution source; campaign names never leave the browser. */
export function coarseTelemetrySource(value: unknown): TelemetrySource {
  if (!isString(value)) return "direct";
  const source = value.trim().toLowerCase();
  if (inList(source, SOURCES)) return source;
  if (source.startsWith("guide-")) return "guide";
  return "other";
}

/** Map a pathname to a small fixed vocabulary; never return a URL or slug. */
export function coarseTelemetryPath(value: unknown): TelemetryEntryPath {
  if (!isString(value)) return "other";
  let pathname = value.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {
    return "other";
  }
  pathname = pathname.split(/[?#]/, 1)[0] ?? pathname;
  if (pathname === "" || pathname === "/") return "home";
  if (pathname === "about" || pathname === "/about.html") return "about";
  if (pathname.startsWith("/guides") || pathname === "guide") return "guide";
  if (pathname.startsWith("/tools") || pathname === "tool") return "tool";
  if (pathname.startsWith("/romaji") || pathname === "romaji") return "romaji";
  if (inList(pathname, PATHS)) return pathname;
  return "other";
}

export function normalizeTelemetryMode(value: unknown): TelemetryMode | null {
  return inList(value, MODES) ? value : null;
}

export function normalizeTelemetryDifficulty(value: unknown): TelemetryDifficulty | null {
  return inList(value, DIFFICULTIES) ? value : null;
}

function normalizePrimitive(key: string, value: unknown): TelemetryPrimitive | null {
  if (key === "source") return inList(value, SOURCES) ? value : null;
  if (key === "path") return inList(value, PATHS) ? value : null;
  if (key === "mode") return inList(value, MODES) ? value : null;
  if (key === "difficulty") return inList(value, DIFFICULTIES) ? value : null;
  if (key === "screen") return inList(value, SCREENS) ? value : null;
  if (key === "context") return inList(value, CONTEXTS) ? value : null;
  if (key === "outcome") return inList(value, OUTCOMES) ? value : null;
  if (key === "entryPoint") return inList(value, ENTRY_POINTS) ? value : null;
  if (key === "focusGoal") return inList(value, FOCUS_GOALS) ? value : null;
  if (key === "surface") return inList(value, RANKING_SURFACES) || inList(value, FAILURE_SURFACES) ? value : null;
  if (key === "action") {
    return inList(value, RANKING_ACTIONS) || inList(value, RESULT_ACTIONS) || inList(value, SHARE_ACTIONS) ||
      inList(value, ANALYSIS_ACTIONS) || inList(value, TRANSFER_ACTIONS) || inList(value, MOBILE_ACTIONS) ||
      inList(value, TOOL_ACTIONS)
      ? value
      : null;
  }
  if (key === "scope") return inList(value, ANALYSIS_SCOPES) ? value : null;
  if (key === "setting") return inList(value, SETTINGS) ? value : null;
  if (key === "value") return inList(value, SETTING_VALUES) ? value : null;
  if (key === "status") return inList(value, TRANSFER_STATUSES) ? value : null;
  if (key === "availability") return inList(value, MOBILE_AVAILABILITY) ? value : null;
  if (key === "tool") return inList(value, TOOLS) ? value : null;
  if (key === "feature") return inList(value, FEATURES) ? value : null;
  if (key === "kind") return inList(value, FAILURE_KINDS) ? value : null;
  if (key === "reason") return value === "confirmed_quit" ? value : null;
  if (key === "firstPlay") return typeof value === "boolean" ? value : null;
  if (key === "ranked") return typeof value === "boolean" ? value : null;
  if (key === "focusAchieved") return typeof value === "boolean" ? value : null;
  if (["scoreBand", "kpmBand", "accuracyBand", "chainBand", "durationBand", "levelBand", "elapsedBand"].includes(key)) {
    return inList(value, STAT_BANDS) ? value : null;
  }
  return null;
}

type PropertySpec = { key: string; optional?: boolean };

const PROPERTY_SPECS: { [N in TelemetryEventName]: readonly PropertySpec[] } = {
  content_entry: [{ key: "source" }, { key: "path" }],
  screen_view: [{ key: "screen" }, { key: "mode", optional: true }, { key: "context", optional: true }],
  game_start: [
    { key: "mode" },
    { key: "difficulty", optional: true },
    { key: "entryPoint", optional: true },
    { key: "ranked", optional: true },
    { key: "firstPlay", optional: true },
    { key: "focusGoal", optional: true },
  ],
  game_finish: [
    { key: "mode" },
    { key: "outcome" },
    { key: "difficulty", optional: true },
    { key: "ranked", optional: true },
    { key: "scoreBand", optional: true },
    { key: "kpmBand", optional: true },
    { key: "accuracyBand", optional: true },
    { key: "chainBand", optional: true },
    { key: "durationBand", optional: true },
    { key: "levelBand", optional: true },
    { key: "focusAchieved", optional: true },
  ],
  tutorial_completed: [{ key: "firstPlay" }, { key: "source", optional: true }],
  game_exit: [
    { key: "mode" },
    { key: "reason" },
    { key: "difficulty", optional: true },
    { key: "elapsedBand", optional: true },
  ],
  result_action: [{ key: "mode" }, { key: "action" }],
  share_action: [{ key: "mode" }, { key: "action" }, { key: "status", optional: true }],
  ranking_action: [
    { key: "surface" },
    { key: "action" },
    { key: "difficulty", optional: true },
    { key: "status", optional: true },
  ],
  analysis_action: [{ key: "scope" }, { key: "action" }],
  settings_change: [{ key: "setting" }, { key: "value" }],
  transfer_action: [{ key: "action" }, { key: "status" }],
  mobile_handoff: [
    { key: "action" },
    { key: "availability", optional: true },
    { key: "status", optional: true },
  ],
  tool_action: [{ key: "tool" }, { key: "action" }],
  feature_used: [{ key: "mode" }, { key: "feature" }],
  flow_failure: [{ key: "surface" }, { key: "kind" }],
};

const REQUIRED_FIELDS: { [N in TelemetryEventName]: readonly string[] } = {
  content_entry: ["source", "path"],
  screen_view: ["screen"],
  game_start: ["mode"],
  game_finish: ["mode", "outcome"],
  tutorial_completed: ["firstPlay"],
  game_exit: ["mode", "reason"],
  result_action: ["mode", "action"],
  share_action: ["mode", "action"],
  ranking_action: ["surface", "action"],
  analysis_action: ["scope", "action"],
  settings_change: ["setting", "value"],
  transfer_action: ["action", "status"],
  mobile_handoff: ["action"],
  tool_action: ["tool", "action"],
  feature_used: ["mode", "feature"],
  flow_failure: ["surface", "kind"],
};

/**
 * Sanitize one event. Unknown keys and raw values are discarded. An event is
 * rejected when a required property is missing or invalid.
 */
export function sanitizeTelemetryProperties<N extends TelemetryEventName>(
  name: N,
  properties: unknown,
): TelemetryPropertiesMap[N] | null {
  if (!inList(name, Object.keys(PROPERTY_SPECS) as TelemetryEventName[])) return null;
  if (!isPlainRecord(properties)) return null;
  const safe: Record<string, TelemetryPrimitive> = {};
  try {
    for (const { key } of PROPERTY_SPECS[name]) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
      const value = normalizePrimitive(key, properties[key]);
      if (value !== null) safe[key] = value;
    }
  } catch {
    return null;
  }
  if (Object.keys(safe).length > MAX_TELEMETRY_EVENT_PROPERTIES) return null;
  if (REQUIRED_FIELDS[name].some((key) => !Object.prototype.hasOwnProperty.call(safe, key))) return null;
  // `action` and `surface` are shared wire keys, but their accepted values are
  // event-specific. Reject cross-event values so a malformed client cannot
  // pollute an unrelated dashboard bucket.
  if (name === "result_action" && !inList(safe.action, RESULT_ACTIONS)) return null;
  if (name === "share_action" && !inList(safe.action, SHARE_ACTIONS)) return null;
  if (name === "ranking_action" && (!inList(safe.action, RANKING_ACTIONS) || !inList(safe.surface, RANKING_SURFACES))) return null;
  if (name === "analysis_action" && !inList(safe.action, ANALYSIS_ACTIONS)) return null;
  if (name === "transfer_action" && !inList(safe.action, TRANSFER_ACTIONS)) return null;
  if (name === "mobile_handoff" && !inList(safe.action, MOBILE_ACTIONS)) return null;
  if (name === "tool_action" && !inList(safe.action, TOOL_ACTIONS)) return null;
  if (name === "flow_failure" && !inList(safe.surface, FAILURE_SURFACES)) return null;
  return safe as TelemetryPropertiesMap[N];
}

function randomId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic in-memory fallback.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createTelemetryEventId(): string {
  return randomId("evt");
}

export function createTelemetryBatchId(): string {
  return randomId("batch");
}

/**
 * Build a validated event with a fresh eventId. The eventId is retained when
 * the containing batch is retried, which makes server-side dedupe possible.
 */
export function createTelemetryEvent<N extends TelemetryEventName>(
  name: N,
  properties: unknown,
  eventId = createTelemetryEventId(),
): TelemetryEvent<N> | null {
  if (!isString(eventId) || eventId.length < 8 || eventId.length > 80) return null;
  const safeProperties = sanitizeTelemetryProperties(name, properties);
  if (!safeProperties) return null;
  return { eventId, name, properties: safeProperties };
}

/** Convert arbitrary numeric game stats into coarse, non-sensitive bands. */
export type TelemetryStatBand =
  | "unknown"
  | "0"
  | "1-999"
  | "1000-4999"
  | "5000-9999"
  | "10000-24999"
  | "25000-49999"
  | "50000+"
  | "under-60"
  | "60-119"
  | "120-179"
  | "180-239"
  | "240+"
  | "under-80"
  | "80-89"
  | "90-94"
  | "95-97"
  | "98-99"
  | "100"
  | "0-1"
  | "2-3"
  | "4-6"
  | "7-9"
  | "10+"
  | "under-15s"
  | "15-29s"
  | "30-59s"
  | "60-119s"
  | "120s+"
  | "1-4"
  | "5-9"
  | "10-19"
  | "20-39"
  | "40+";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function bandScore(value: unknown): TelemetryStatBand {
  const score = finiteNumber(value);
  if (score === null || score < 0) return "unknown";
  if (score < 1_000) return score === 0 ? "0" : "1-999";
  if (score < 5_000) return "1000-4999";
  if (score < 10_000) return "5000-9999";
  if (score < 25_000) return "10000-24999";
  if (score < 50_000) return "25000-49999";
  return "50000+";
}

export function bandKpm(value: unknown): TelemetryStatBand {
  const kpm = finiteNumber(value);
  if (kpm === null || kpm < 0) return "unknown";
  if (kpm < 60) return "under-60";
  if (kpm < 120) return "60-119";
  if (kpm < 180) return "120-179";
  if (kpm < 240) return "180-239";
  return "240+";
}

export function bandAccuracy(value: unknown): TelemetryStatBand {
  const raw = finiteNumber(value);
  if (raw === null || raw < 0) return "unknown";
  const percentage = raw <= 1 ? raw * 100 : raw;
  if (percentage > 100) return "unknown";
  if (percentage < 80) return "under-80";
  if (percentage < 90) return "80-89";
  if (percentage < 95) return "90-94";
  if (percentage < 98) return "95-97";
  if (percentage < 100) return "98-99";
  return "100";
}

export function bandChain(value: unknown): TelemetryStatBand {
  const chain = finiteNumber(value);
  if (chain === null || chain < 0) return "unknown";
  if (chain < 2) return "0-1";
  if (chain < 4) return "2-3";
  if (chain < 7) return "4-6";
  if (chain < 10) return "7-9";
  return "10+";
}

export function bandDuration(value: unknown): TelemetryStatBand {
  const milliseconds = finiteNumber(value);
  if (milliseconds === null || milliseconds < 0) return "unknown";
  // All game/controller call sites expose elapsed time in milliseconds.
  // Heuristically accepting seconds makes values around 301ms look like a
  // five-minute session, so keep one unambiguous unit at the boundary.
  const seconds = milliseconds / 1_000;
  if (seconds < 15) return "under-15s";
  if (seconds < 30) return "15-29s";
  if (seconds < 60) return "30-59s";
  if (seconds < 120) return "60-119s";
  return "120s+";
}

export function bandLevel(value: unknown): TelemetryStatBand {
  const level = finiteNumber(value);
  if (level === null || level < 1) return "unknown";
  if (level < 5) return "1-4";
  if (level < 10) return "5-9";
  if (level < 20) return "10-19";
  if (level < 40) return "20-39";
  return "40+";
}

// Short aliases used by feature instrumentation and kept intentionally
// explicit so a raw stat cannot accidentally be passed through.
export { coarseTelemetrySource as normalizeTelemetrySource, coarseTelemetryPath as normalizeTelemetryPath };
