import { useEffect, useState } from "react";
import { useFitToViewport } from "../hooks/useFitToViewport";
import { fetchTopScores, type RankingEntry } from "../ranking";

interface Props {
  onBack: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: RankingEntry[] };

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RankingScreen({ onBack }: Props): JSX.Element {
  const { ref, style } = useFitToViewport<HTMLDivElement>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchTopScores(100)
      .then((entries) => {
        if (!cancelled) setState({ status: "loaded", entries });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : "不明なエラー" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  return (
    <div ref={ref} style={style} className="screen ranking">
      <h1 className="logo ranking-title">
        RANKING <span className="logo-blast">(サバイバル・全期間)</span>
      </h1>

      {state.status === "loading" && <p className="ranking-status">読み込み中…</p>}
      {state.status === "error" && (
        <p className="ranking-status ranking-error">
          ランキングを取得できませんでした。時間をおいて再度お試しください。
        </p>
      )}
      {state.status === "loaded" && state.entries.length === 0 && (
        <p className="ranking-status">まだ記録がありません。最初のランカーになろう!</p>
      )}
      {state.status === "loaded" && state.entries.length > 0 && (
        <div className="ranking-table-wrap">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ニックネーム</th>
                <th>スコア</th>
                <th>最大連鎖</th>
                <th>生存時間</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((entry, i) => (
                <tr key={entry.id} className={i < 3 ? `ranking-top ranking-top-${i + 1}` : undefined}>
                  <td>{i + 1}</td>
                  <td className="ranking-nickname">{entry.nickname}</td>
                  <td>{entry.score.toLocaleString()}</td>
                  <td>{entry.maxChain}</td>
                  <td>{formatTime(entry.survivedMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="btn-secondary" onClick={onBack} autoFocus>
        タイトルへ戻る <span className="btn-sub">Esc</span>
      </button>
    </div>
  );
}
