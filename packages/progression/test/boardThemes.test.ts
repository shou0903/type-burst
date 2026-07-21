import { describe, expect, it } from "vitest";
import {
  BOARD_THEMES,
  boardThemeById,
  isBoardThemeUnlocked,
  resolveBoardTheme,
} from "../src/boardThemes";

describe("BOARD_THEMES", () => {
  it("先頭はdefaultで、解放スコアは0(常時解放)", () => {
    expect(BOARD_THEMES[0]!.id).toBe("default");
    expect(BOARD_THEMES[0]!.unlockScore).toBe(0);
  });

  it("unlockScoreは昇順である", () => {
    for (let i = 1; i < BOARD_THEMES.length; i++) {
      expect(BOARD_THEMES[i]!.unlockScore).toBeGreaterThan(BOARD_THEMES[i - 1]!.unlockScore);
    }
  });

  it("各テーマは4属性すべての配色を持つ", () => {
    for (const theme of BOARD_THEMES) {
      for (const attr of ["fire", "water", "wind", "light"] as const) {
        expect(theme.colors[attr]).toBeDefined();
        expect(theme.colors[attr].fill).toMatch(/^#/);
      }
    }
  });
});

describe("isBoardThemeUnlocked", () => {
  it("defaultは累計スコア0でも解放済み", () => {
    expect(isBoardThemeUnlocked("default", 0)).toBe(true);
  });

  it("しきい値未満は未解放、ちょうど・以上は解放", () => {
    const theme = BOARD_THEMES[1]!;
    expect(isBoardThemeUnlocked(theme.id, theme.unlockScore - 1)).toBe(false);
    expect(isBoardThemeUnlocked(theme.id, theme.unlockScore)).toBe(true);
    expect(isBoardThemeUnlocked(theme.id, theme.unlockScore + 1)).toBe(true);
  });
});

describe("boardThemeById", () => {
  it("存在するidはそのテーマを返す", () => {
    expect(boardThemeById("ocean").id).toBe("ocean");
  });

  it("不正なidが渡ってもdefaultへフォールバックする(型を無視した壊れたデータ想定)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(boardThemeById("not-a-real-theme" as any).id).toBe("default");
  });
});

describe("resolveBoardTheme", () => {
  it("解放済みテーマはそのまま使われる", () => {
    const theme = BOARD_THEMES[1]!;
    expect(resolveBoardTheme(theme.id, theme.unlockScore, false).id).toBe(theme.id);
  });

  it("未解放テーマが指定されていた場合はdefaultへフォールバックする", () => {
    const theme = BOARD_THEMES[BOARD_THEMES.length - 1]!;
    expect(resolveBoardTheme(theme.id, 0, false).id).toBe("default");
  });

  it("highContrast時は解放済みでも常にdefaultへフォールバックする(視認性優先)", () => {
    const theme = BOARD_THEMES[1]!;
    expect(resolveBoardTheme(theme.id, theme.unlockScore, true).id).toBe("default");
  });
});
