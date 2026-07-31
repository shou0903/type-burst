import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VercelRequest } from "@vercel/node";
import { isAuthorizedAdmin } from "./adminAuth";

function requestWith(authorization?: string): VercelRequest {
  return { headers: authorization === undefined ? {} : { authorization } } as unknown as VercelRequest;
}

describe("isAuthorizedAdmin", () => {
  const ORIGINAL = process.env.ADMIN_STATS_TOKEN;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_STATS_TOKEN;
    else process.env.ADMIN_STATS_TOKEN = ORIGINAL;
  });

  it("環境変数が未設定なら、正しいトークンを送っても拒否する", () => {
    delete process.env.ADMIN_STATS_TOKEN;
    expect(isAuthorizedAdmin(requestWith("Bearer anything"))).toBe(false);
  });

  it("正しいトークンなら許可する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(isAuthorizedAdmin(requestWith("Bearer correct-token-value"))).toBe(true);
  });

  it("誤ったトークンは拒否する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(isAuthorizedAdmin(requestWith("Bearer wrong-token-value"))).toBe(false);
  });

  it("長さが違うトークンでも例外を投げずに拒否する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(() => isAuthorizedAdmin(requestWith("Bearer short"))).not.toThrow();
    expect(isAuthorizedAdmin(requestWith("Bearer short"))).toBe(false);
  });

  it("Authorizationヘッダが無ければ拒否する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(isAuthorizedAdmin(requestWith())).toBe(false);
  });

  it("Bearerプレフィックスが無ければ拒否する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(isAuthorizedAdmin(requestWith("correct-token-value"))).toBe(false);
  });

  it("空のBearerトークンは拒否する", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    expect(isAuthorizedAdmin(requestWith("Bearer "))).toBe(false);
  });

  it("配列ヘッダ(重複ヘッダ)でも例外を投げない", () => {
    process.env.ADMIN_STATS_TOKEN = "correct-token-value";
    const req = { headers: { authorization: ["Bearer correct-token-value"] } } as unknown as VercelRequest;
    expect(() => isAuthorizedAdmin(req)).not.toThrow();
  });
});
