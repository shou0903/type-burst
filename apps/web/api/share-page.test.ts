import { describe, expect, it } from "vitest";
import { DAILY_SHARE_TARGET, HOME_SHARE_TARGET } from "../shareTarget";
import { renderHtml } from "./share-page";

const base = {
  id: "Abcd2345Efgh",
  title: "デイリーチャレンジ 123,456点",
  description: "今日の共通盤面で勝負",
  imageUrl: "https://type-burst.com/og-image-v3.png",
  found: true,
};

describe("share result landing page", () => {
  it("sends daily-result visitors to today's common challenge", () => {
    const html = renderHtml({ ...base, targetPath: DAILY_SHARE_TARGET });

    expect(html).toContain('href="/?mode=daily&amp;source=share#play"');
    expect(html).toContain("今日の2分勝負に挑戦");
  });

  it("keeps legacy and non-daily shares pointed at home", () => {
    const html = renderHtml({ ...base, targetPath: HOME_SHARE_TARGET });

    expect(html).toContain('<a class="rp-cta" href="/">この記録に挑戦する');
    expect(html).not.toContain("mode=daily");
  });
});
