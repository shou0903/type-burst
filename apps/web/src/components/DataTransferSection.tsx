import { useMemo, useState } from "react";
import { titleProgressForScore } from "@type-burst/progression";
import {
  buildPlayerSnapshot,
  deleteCloudPlayerData,
  issueTransferCode,
  previewRestore,
  replaceLocalPlayerData,
  restoreFromCode,
  type PlayerSnapshot,
} from "../playerData";

type PendingRestore = { code: string; snapshot: PlayerSnapshot };

export function DataTransferSection(): JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [busy, setBusy] = useState<"issue" | "lookup" | "restore" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = useMemo(() => buildPlayerSnapshot(), []);

  const issue = async (): Promise<void> => {
    setBusy("issue");
    setMessage(null);
    try {
      setCode(await issueTransferCode());
    } catch {
      setMessage("コードを発行できませんでした。通信状況を確認して、もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setMessage("引き継ぎコードをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。コードを選択して手動でコピーしてください。");
    }
  };

  const inspect = async (): Promise<void> => {
    setBusy("lookup");
    setMessage(null);
    try {
      const preview = await previewRestore(input);
      setPending({ code: input, snapshot: preview.snapshot });
    } catch {
      // 不正形式・存在しないコード・期限切れは同じ文言にする。
      setMessage("コードを確認できませんでした。入力内容を確認して、時間をおいて再度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (): Promise<void> => {
    if (!pending) return;
    setBusy("restore");
    try {
      const snapshot = await restoreFromCode(pending.code);
      replaceLocalPlayerData(snapshot);
      window.location.reload();
    } catch {
      setMessage("復元できませんでした。通信状況を確認して、もう一度お試しください。");
      setPending(null);
      setBusy(null);
    }
  };

  const removeCloudData = async (): Promise<void> => {
    if (!window.confirm("クラウドに保存した記録と引き継ぎコードを削除します。端末内の記録は残ります。続けますか？")) return;
    setBusy("delete");
    setMessage(null);
    try {
      await deleteCloudPlayerData();
      setCode(null);
      setMessage("クラウドに保存した記録と引き継ぎコードを削除しました。端末内の記録は残っています。");
    } catch {
      setMessage("削除できませんでした。通信状況を確認して、もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="data-transfer" aria-labelledby="data-transfer-title">
      <div className="data-transfer-heading">
        <div>
          <p className="data-transfer-kicker">DATA TRANSFER</p>
          <h2 id="data-transfer-title">データの引き継ぎ</h2>
        </div>
        <span className="data-transfer-badge">登録不要</span>
      </div>
      <p className="data-transfer-lede">
        匿名の引き継ぎコードで、称号・成長記録・デイリー連続記録・対戦戦績を別のPCへ移せます。
      </p>

      <div className="data-transfer-grid">
        <div className="data-transfer-card">
          <h3>この記録を持ち出す</h3>
          <p>コードは再発行すると古いものがすぐ使えなくなります。</p>
          <button type="button" className="data-transfer-primary" onClick={issue} disabled={busy !== null}>
            {busy === "issue" ? "発行中…" : "引き継ぎコードを発行"}
          </button>
          {code && (
            <div className="transfer-code-wrap">
              <output className="transfer-code" aria-label="引き継ぎコード">{code}</output>
              <button type="button" className="data-transfer-copy" onClick={copy}>コピー</button>
            </div>
          )}
          <p className="data-transfer-warning">
            このコードを知っている人は誰でも記録を復元できます。他人に見せないでください。
          </p>
        </div>

        <div className="data-transfer-card">
          <h3>別のPCの記録を復元</h3>
          <p>復元前に必ず記録の比較画面を表示します。自動で合算されることはありません。</p>
          <label className="transfer-input-label" htmlFor="transfer-code-input">引き継ぎコード</label>
          <input
            id="transfer-code-input"
            className="transfer-input"
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JKMN"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="data-transfer-secondary" onClick={inspect} disabled={busy !== null || input.trim().length === 0}>
            {busy === "lookup" ? "確認中…" : "コードを確認して復元"}
          </button>
        </div>
      </div>

      <div className="data-transfer-footer">
        <button type="button" className="data-transfer-delete" onClick={removeCloudData} disabled={busy !== null}>
          クラウドに保存した記録を削除
        </button>
        <span>端末の設定（音量・文字サイズなど）は引き継ぎません。</span>
      </div>
      {message && <p className="data-transfer-message" role="status">{message}</p>}

      {pending && (
        <div className="transfer-modal-backdrop" role="presentation">
          <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-compare-title">
            <p className="data-transfer-kicker">RESTORE CHECK</p>
            <h2 id="transfer-compare-title">この記録で上書きしますか？</h2>
            <p>
              自動マージは行いません。<strong>この端末の現在の記録は失われます。</strong>
            </p>
            <div className="transfer-compare">
              <SnapshotSummary label="この端末の記録" snapshot={current} />
              <SnapshotSummary label="コード側の記録" snapshot={pending.snapshot} accent />
            </div>
            <div className="transfer-modal-actions">
              <button type="button" className="data-transfer-secondary" onClick={() => setPending(null)} disabled={busy === "restore"}>キャンセル</button>
              <button type="button" className="data-transfer-primary" onClick={restore} disabled={busy === "restore"}>
                {busy === "restore" ? "復元中…" : "この記録で上書きする"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function SnapshotSummary({ label, snapshot, accent = false }: { label: string; snapshot: PlayerSnapshot; accent?: boolean }): JSX.Element {
  const title = titleProgressForScore(snapshot.progress.totalScore).current.label;
  return (
    <div className={accent ? "transfer-summary transfer-summary-accent" : "transfer-summary"}>
      <p>{label}</p>
      <dl>
        <div><dt>ニックネーム</dt><dd>{snapshot.nickname || "未設定"}</dd></div>
        <div><dt>称号</dt><dd>{title}</dd></div>
        <div><dt>連続日数</dt><dd>{snapshot.dailyProgress.currentStreak}日</dd></div>
        <div><dt>累計プレイ回数</dt><dd>{snapshot.progress.totalGames.toLocaleString()}回</dd></div>
        <div><dt>ベストスコア</dt><dd>{snapshot.progress.bestScore.toLocaleString()}</dd></div>
      </dl>
    </div>
  );
}
