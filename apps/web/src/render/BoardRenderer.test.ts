import { describe, expect, it } from "vitest";
import { HERO_RENDERER_OPTIONS, ATTRACT_RENDERER_OPTIONS, canvasSize, constrainPopupScale, popupSafeWidth } from "./BoardRenderer";

describe("attract/hero popup bounds", () => {
  it("keeps animated popup scale within the safe width", () => {
    const safeWidth = popupSafeWidth(canvasSize(ATTRACT_RENDERER_OPTIONS).w, 1, 12) - 24;
    // A 50px popup can be wider than the 304px attract canvas; the helper must cap it.
    const scale = constrainPopupScale(360, 1.15, safeWidth);

    expect(scale).toBeLessThanOrEqual(safeWidth / 360);
    expect(360 * scale).toBeLessThanOrEqual(safeWidth);
  });

  it("accounts for an outer transform when calculating a popup viewport", () => {
    const heroWidth = canvasSize(HERO_RENDERER_OPTIONS).w;

    expect(popupSafeWidth(heroWidth, 1.2, 12)).toBeCloseTo((heroWidth - 24) / 1.2);
    expect(popupSafeWidth(heroWidth, 1, 12)).toBeGreaterThan(popupSafeWidth(heroWidth, 1.2, 12));
  });

  it("has the expected compact logical widths", () => {
    expect(canvasSize(ATTRACT_RENDERER_OPTIONS).w).toBe(304);
    expect(canvasSize(HERO_RENDERER_OPTIONS).w).toBe(392);
  });
});
