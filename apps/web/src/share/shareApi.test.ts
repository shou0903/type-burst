import { describe, expect, it } from "vitest";
import { DAILY_SHARE_TARGET, HOME_SHARE_TARGET } from "../../shareTarget";
import { shareFallbackUrl } from "./shareApi";

describe("share API fallback", () => {
  it("keeps the daily challenge entry when card upload fails", () => {
    expect(shareFallbackUrl(DAILY_SHARE_TARGET)).toBe(
      "https://type-burst.com/?mode=daily&source=share#play",
    );
  });

  it("keeps ordinary results pointed at home", () => {
    expect(shareFallbackUrl(HOME_SHARE_TARGET)).toBe("https://type-burst.com/");
  });
});
