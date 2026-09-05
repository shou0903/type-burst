import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./playerId", () => ({ loadPlayerId: () => "player-test-1234" }));

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("first-party behavior telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: storageStub(),
      sessionStorage: storageStub(),
      location: { pathname: "/", search: "" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  });

  it("batches only the sanitized event and keeps playerId out of event properties", async () => {
    const telemetry = await import("./behaviorTelemetry");
    (telemetry.trackBehaviorEvent as unknown as (name: string, properties: Record<string, unknown>) => void)("game_start", {
      mode: "survival",
      difficulty: "easy",
      typedText: "must-be-dropped",
      playerId: "must-be-dropped",
    });
    await telemetry.flushBehaviorTelemetry();

    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      playerId: string;
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(body.playerId).toBe("player-test-1234");
    expect(body.events[0]?.properties).toEqual({ mode: "survival", difficulty: "easy" });
    expect(JSON.stringify(body.events)).not.toContain("player-test-1234");
    expect(JSON.stringify(body)).not.toContain("must-be-dropped");
  });

  it("stops immediately and clears pending events when the user opts out", async () => {
    const telemetry = await import("./behaviorTelemetry");
    telemetry.trackBehaviorEvent("screen_view", { screen: "home" });
    telemetry.setBehaviorTelemetryEnabled(false);
    telemetry.trackBehaviorEvent("screen_view", { screen: "game", mode: "survival" });
    await telemetry.flushBehaviorTelemetry();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deduplicates content milestones across a reload in the same tab", async () => {
    const localStorage = storageStub();
    const sessionStorage = storageStub();
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage,
      location: { pathname: "/", search: "" },
      addEventListener: vi.fn(),
    });
    let telemetry = await import("./behaviorTelemetry");
    telemetry.trackBehaviorEventOnce("content-entry:direct:home", "content_entry", { source: "direct", path: "home" });
    await telemetry.flushBehaviorTelemetry();
    vi.resetModules();
    telemetry = await import("./behaviorTelemetry");
    telemetry.trackBehaviorEventOnce("content-entry:direct:home", "content_entry", { source: "direct", path: "home" });
    await telemetry.flushBehaviorTelemetry();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
