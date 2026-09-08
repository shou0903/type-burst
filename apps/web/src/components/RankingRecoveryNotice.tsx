import { useEffect, useState } from "react";
import {
  loadPendingRankingSubmissions,
  retryPendingRankingSubmissions,
  type PendingRankingSubmission,
} from "../rankingOutbox";

/**
 * 結果画面を閉じた後に通信が戻ったことをユーザーへ伝える、控えめな回復導線。
 * 保留中の内容（名前・スコア）は表示せず、件数だけを案内する。
 */
export function RankingRecoveryNotice(): JSX.Element | null {
  const [pending, setPending] = useState<PendingRankingSubmission[]>(() =>
    loadPendingRankingSubmissions(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = (): void => setPending(loadPendingRankingSubmissions());
    window.addEventListener("typeburst:ranking-outbox-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("typeburst:ranking-outbox-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (pending.length === 0) return null;

  const retry = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await retryPendingRankingSubmissions();
    } finally {
      setPending(loadPendingRankingSubmissions());
      setBusy(false);
    }
  };

  return (
    <section className="ranking-recovery" aria-live="polite">
      <div>
        <strong>ランキング登録を保留中</strong>
        <p>
          通信が戻り次第、自動で再送します（残り{pending.length}件）。
          このページから今すぐ再試行することもできます。
        </p>
      </div>
      <button type="button" className="btn-secondary" onClick={() => void retry()} disabled={busy}>
        {busy ? "再送中…" : "ランキングを再送"}
      </button>
    </section>
  );
}
