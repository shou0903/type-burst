import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mockAccepted = vi.fn();
const mockDeleted = vi.fn();

vi.mock("./_shared/shareStore.js", () => ({
  getClientIp: () => "198.51.100.20",
  getRedis: () => ({}),
}));

vi.mock("./_shared/telemetryStore.js", async () => {
  const actual = await vi.importActual<typeof import("./_shared/telemetryStore.js")>("./_shared/telemetryStore.js");
  return {
    ...actual,
    RedisTelemetryStore: class {
      public constructor(_redis: unknown) {}
      public async accept(input: unknown): Promise<void> { mockAccepted(input); }
      public async deletePlayer(playerId: string): Promise<void> { mockDeleted(playerId); }
    },
  };
});
import handler from "./telemetry";

function makeResponse(): VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string): void { response.headers[name] = value; },
    status(code: number) { response.statusCode = code; return response; },
    json(payload: unknown): void { response.body = payload; },
    end(): void {},
  };
  return response as unknown as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
}

function request(method: string, body: unknown, headers: Record<string, string> = {}): VercelRequest {
  return {
    method,
    body,
    headers: {
      origin: "https://type-burst.com",
      "content-type": "application/json",
      ...headers,
    },
    socket: { remoteAddress: "198.51.100.20" },
  } as unknown as VercelRequest;
}

const payload = {
  v: 1,
  batchId: "batch-12345678",
  sessionId: "session-12345678",
  playerId: "player-12345678",
  events: [{
    eventId: "event-12345678",
    name: "game_start",
    properties: { mode: "survival", difficulty: "easy" },
  }],
};

describe("/api/telemetry HTTP boundary", () => {
  beforeEach(() => {
    mockAccepted.mockReset();
    mockDeleted.mockReset();
  });

  it("requires exact same-origin JSON and rejects oversized bodies", async () => {
    const badOrigin = makeResponse();
    await handler(request("POST", payload, { origin: "https://evil.example" }), badOrigin);
    expect(badOrigin.statusCode).toBe(403);
    expect(mockAccepted).not.toHaveBeenCalled();

    const oversized = makeResponse();
    await handler(request("POST", payload, { "content-length": "20000" }), oversized);
    expect(oversized.statusCode).toBe(413);
  });

  it("never echoes the transient playerId in a successful response", async () => {
    const response = makeResponse();
    await handler(request("POST", payload), response);
    expect(response.statusCode).toBe(204);
    expect(JSON.stringify(response.body ?? "")).not.toContain(payload.playerId);
    expect(mockAccepted).toHaveBeenCalledOnce();
  });

  it("handles an identity deletion idempotently without exposing identity state", async () => {
    const response = makeResponse();
    await handler(request("DELETE", { v: 1, playerId: payload.playerId }), response);
    expect(response.statusCode).toBe(204);
    expect(mockDeleted).toHaveBeenCalledWith(payload.playerId);
    expect(JSON.stringify(response.body ?? "")).not.toContain(payload.playerId);
  });
});
