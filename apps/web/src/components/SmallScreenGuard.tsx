import { useEffect, useState } from "react";

const MIN_WIDTH = 1024;

function isTooNarrow(): boolean {
  return window.innerWidth < MIN_WIDTH;
}

/**
 * 仕様書 §4: 推奨最小幅1024px・物理キーボード必須・スマートフォン最適化はMVP外。
 * useFitToViewport による無限縮小に任せず、狭い画面では明示的に案内する。
 */
export function SmallScreenGuard({ children }: { children: JSX.Element }): JSX.Element {
  const [tooNarrow, setTooNarrow] = useState(isTooNarrow);

  useEffect(() => {
    const check = (): void => setTooNarrow(isTooNarrow());
    window.addEventListener("resize", check);
    const intervalId = window.setInterval(check, 500);
    return () => {
      window.removeEventListener("resize", check);
      window.clearInterval(intervalId);
    };
  }, []);

  if (!tooNarrow) return children;

  return (
    <div className="narrow-guard">
      <h1 className="narrow-guard-logo">
        TYPE <span className="narrow-guard-burst">BURST</span>
      </h1>
      <p className="narrow-guard-message">
        このゲームは物理キーボードでのローマ字入力を前提としています。
        <br />
        画面幅 {MIN_WIDTH}px 以上のPCブラウザでお楽しみください。
      </p>
      <p className="narrow-guard-sub">スマートフォン・タブレット表示には対応していません。</p>
    </div>
  );
}
