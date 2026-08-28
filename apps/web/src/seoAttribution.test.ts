import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: trackMock }));

import {
  captureContentAttribution,
  trackAttributedGameStart,
  trackFunnelEvent,
  trackLandingView,
} from "./seoAttribution";

const values = new Map<string, string>();
const sessionStorageStub = {
  getItem: (key: string): string | null => values.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    values.set(key, value);
  },
};

describe("anonymous funnel analytics", () => {
  beforeEach(() => {
    values.clear();
    trackMock.mockClear();
    vi.stubGlobal("window", {
      location: { search: "?utm_source=google-organic", pathname: "/" },
      sessionStorage: sessionStorageStub,
    });
    vi.stubGlobal("document", { referrer: "" });
  });

  it("keeps only allowlisted, coarse properties and caps them at two", () => {
    trackFunnelEvent("Game Started", {
      mode: "survival",
      playerId: "must-not-leave-device",
      source: "unbounded-campaign-name",
      difficulty: "hard",
    });

    expect(trackMock).toHaveBeenCalledWith("Game Started", {
      mode: "survival",
      source: "other",
    });
  });

  it("captures attribution before the first entry and sends it once per session", () => {
    trackLandingView();
    trackLandingView();

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("Content Entry", {
      source: "google-organic",
      path: "home",
    });
  });

  it("does not overwrite the session source with direct on a later title view", () => {
    captureContentAttribution();
    window.location.search = "";
    captureContentAttribution();
    trackAttributedGameStart("survival");

    expect(trackMock).toHaveBeenLastCalledWith("Game Started", {
      mode: "survival",
      source: "google-organic",
    });
  });

  it("keeps result-share traffic as a measurable coarse source", () => {
    window.location.search = "?mode=daily&source=share";
    captureContentAttribution();
    trackAttributedGameStart("daily");

    expect(trackMock).toHaveBeenLastCalledWith("Game Started", {
      mode: "daily",
      source: "share",
    });
  });
});
