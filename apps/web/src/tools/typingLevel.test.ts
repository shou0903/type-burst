import { describe, expect, it } from "vitest";
import { diagnoseTypingLevel } from "./typingLevel";

describe("タイピングレベル診断", () => {
  it("正確率が低い場合は速度に関係なく正確性を優先する", () => {
    expect(diagnoseTypingLevel(500, 89.9).label).toBe("基礎を整える段階");
    expect(diagnoseTypingLevel(500, 94.9).label).toBe("正確性を安定させる段階");
  });

  it("正確率95%以上ではKPMの段階を判定する", () => {
    expect(diagnoseTypingLevel(149, 95).label).toBe("入門");
    expect(diagnoseTypingLevel(150, 95).label).toBe("初級");
    expect(diagnoseTypingLevel(250, 98).label).toBe("中級");
    expect(diagnoseTypingLevel(350, 98).label).toBe("上級");
    expect(diagnoseTypingLevel(450, 98).label).toBe("高速・熟練");
  });

  it("どの段階にも具体的な次の行動がある", () => {
    for (const [kpm, accuracy] of [[100, 85], [300, 92], [100, 99], [200, 99], [300, 99], [400, 99], [500, 99]]) {
      const level = diagnoseTypingLevel(kpm!, accuracy!);
      expect(level.nextAction.length).toBeGreaterThan(0);
      expect(level.href).toMatch(/^\//);
      expect(level.linkLabel.length).toBeGreaterThan(0);
    }
  });
});
