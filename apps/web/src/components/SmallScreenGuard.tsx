import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { MobileLanding } from "./MobileLanding";

const MIN_WIDTH = 1024;

function isTooNarrow(): boolean {
  return window.innerWidth < MIN_WIDTH;
}

/**
 * 仕様書 §4: 推奨最小幅1024px・物理キーボード必須・スマートフォン最適化はMVP外。
 * useFitToViewport による無限縮小に任せず、狭い画面では明示的に案内する。
 *
 * D-057: 従来はここで単なる「非対応」の案内文だけを表示し、TikTok等からの
 * モバイル流入をそのまま離脱させていた。ゲームを遊べるようにするのではなく
 * (物理キーボード前提は変えない)、離脱させずPCでの再訪を後押しする
 * `MobileLanding` に差し替えた。PC(1024px以上)側の分岐・挙動は一切変更していない。
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
    <>
      <MobileLanding />
      {/* PC側(AppRoot.tsx)と同じくCookie不使用・個人を特定しない集計のみ(D-037)。
          モバイル流入がどれだけこのランディングに到達しているかを計測できるよう、
          こちらの分岐でも常時計測する。 */}
      <Analytics />
    </>
  );
}
