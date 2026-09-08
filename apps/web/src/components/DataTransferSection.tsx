import { useEffect, useRef, useState } from "react";
import { titleProgressForScore } from "@type-burst/progression";
import {
  buildPlayerSnapshot,
  clearLastSnapshotUploadAt,
  deleteCloudPlayerData,
  issueTransferCode,
  loadLastSnapshotUploadAt,
  previewRestore,
  replaceLocalPlayerData,
  restoreFromCode,
  type PlayerSnapshot,
} from "../playerData";
import {
  deleteTelemetryIdentity,
  flushBehaviorTelemetry,
  isBehaviorTelemetryEnabled,
  setBehaviorTelemetryEnabled,
  trackBehaviorEvent,
} from "../behaviorTelemetry";

type PendingRestore = { code: string; snapshot: PlayerSnapshot; current: PlayerSnapshot };

const MODAL_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DataTransferSection(): JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [busy, setBusy] = useState<"issue" | "lookup" | "restore" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => isBehaviorTelemetryEnabled());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => loadLastSnapshotUploadAt());
  const modalTitleRef = useRef<HTMLHeadingElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeRestorePreview = (): void => {
    trackBehaviorEvent("transfer_action", { action: "restore", status: "cancel" });
    setPending(null);
  };

  useEffect(() => {
    const handleSync = (): void => setLastSyncAt(loadLastSnapshotUploadAt());
    window.addEventListener("typeburst:snapshot-uploaded", handleSync);
    return () => window.removeEventListener("typeburst:snapshot-uploaded", handleSync);
  }, []);

  // モーダルを閉じたら、開く直前に操作していたコントロールへ戻す。
  // 復元失敗時にも設定画面の現在地を失わせない。
  useEffect(() => {
    if (!pending) {
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      if (previous && document.contains(previous)) {
        window.requestAnimationFrame(() => previous.focus());
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => modalTitleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pending]);

  // Tabキーをモーダル内に閉じ込め、背面の設定画面へフォーカスが抜けないようにする。
  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (busy === "restore") return;
        event.preventDefault();
        closeRestorePreview();
        return;
      }
      if (event.key !== "Tab") return;

      const modal = modalRef.current;
      if (!modal) return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        modalTitleRef.current?.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      // 開く直後は見出し(tabIndex=-1)にフォーカスしている。そこから
      // Shift+Tabを押しても背面へ抜けないよう「操作可能要素でない」状態も
      // ループ対象として扱う。
      const activeIsFocusable = active instanceof HTMLElement && focusable.includes(active);
      if (event.shiftKey && (!activeIsFocusable || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!activeIsFocusable || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pending, busy]);

  const issue = async (): Promise<void> => {
    setBusy("issue");
    setMessage(null);
    trackBehaviorEvent("transfer_action", { action: "issue", status: "started" });
    try {
      setCode(await issueTransferCode());
      trackBehaviorEvent("transfer_action", { action: "issue", status: "success" });
    } catch {
      setMessage("コードを発行できませんでした。通信状況を確認して、もう一度お試しください。");
      trackBehaviorEvent("transfer_action", { action: "issue", status: "error" });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setMessage("引き継ぎコードをコピーしました。");
      trackBehaviorEvent("transfer_action", { action: "copy", status: "success" });
    } catch {
      setMessage("コピーできませんでした。コードを選択して手動でコピーしてください。");
      trackBehaviorEvent("transfer_action", { action: "copy", status: "error" });
    }
  };

  const inspect = async (): Promise<void> => {
    const activeBeforeLookup =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy("lookup");
    setMessage(null);
    trackBehaviorEvent("transfer_action", { action: "lookup", status: "started" });
    try {
      const preview = await previewRestore(input);
      returnFocusRef.current = activeBeforeLookup;
      setPending({ code: input, snapshot: preview.snapshot, current: buildPlayerSnapshot() });
      trackBehaviorEvent("transfer_action", { action: "lookup", status: "success" });
    } catch {
      // 不正形式・存在しないコード・期限切れは同じ文言にする。
      setMessage("コードを確認できませんでした。入力内容を確認して、時間をおいて再度お試しください。");
      trackBehaviorEvent("transfer_action", { action: "lookup", status: "error" });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (): Promise<void> => {
    if (!pending) return;
    setBusy("restore");
    trackBehaviorEvent("transfer_action", { action: "restore", status: "started" });
    try {
      const snapshot = await restoreFromCode(pending.code);
      replaceLocalPlayerData(snapshot);
      trackBehaviorEvent("transfer_action", { action: "restore", status: "success" });
      window.location.reload();
    } catch {
      setMessage("復元できませんでした。通信状況を確認して、もう一度お試しください。");
      trackBehaviorEvent("transfer_action", { action: "restore", status: "error" });
      setPending(null);
      setBusy(null);
    }
  };

  const removeCloudData = async (): Promise<void> => {
    if (!window.confirm("クラウドに保存した記録と引き継ぎコードを削除します。端末内の記録は残ります。続けますか？")) {
      trackBehaviorEvent("transfer_action", { action: "delete", status: "cancel" });
      return;
    }
    setBusy("delete");
    setMessage(null);
    trackBehaviorEvent("transfer_action", { action: "delete", status: "started" });
    // The deletion-start event must be sent before identity removal. Sending a
    // success event afterwards would immediately recreate today's HMAC member.
    await flushBehaviorTelemetry();
    // 2つの保管先は独立しているため、片方の失敗で他方の削除を
    // スキップしない。特にクラウド削除は取り消せないので、後続の
    // 計測削除が失敗した場合も実際に起きたことを明示する。
    const [cloudDeletion, telemetryDeletion] = await Promise.allSettled([
      deleteCloudPlayerData(),
      deleteTelemetryIdentity(),
    ]);
    const cloudDeleted = cloudDeletion.status === "fulfilled";
    const telemetryDeleted = telemetryDeletion.status === "fulfilled";

    if (cloudDeleted) {
      clearLastSnapshotUploadAt();
      setCode(null);
    }

    if (cloudDeleted && telemetryDeleted) {
      setMessage("クラウドに保存した記録と引き継ぎコードを削除しました。端末内の記録は残っています。");
    } else if (cloudDeleted) {
      setMessage(
        "クラウドのプレイ記録と引き継ぎコードは削除しましたが、匿名計測データの削除確認に失敗しました。通信状況を確認して、もう一度お試しください。",
      );
      trackBehaviorEvent("transfer_action", { action: "delete", status: "error" });
    } else if (telemetryDeleted) {
      setMessage(
        "匿名計測データは削除しましたが、クラウドのプレイ記録を削除できませんでした。通信状況を確認して、もう一度お試しください。",
      );
    } else {
      setMessage("削除できませんでした。通信状況を確認して、もう一度お試しください。");
      trackBehaviorEvent("transfer_action", { action: "delete", status: "error" });
    }
    setBusy(null);
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
      <p className="data-transfer-sync-note">
        ゲーム終了時に自動保存されます。通信に失敗してもプレイは中断されません。
        {lastSyncAt
          ? ` 最終保存: ${new Date(lastSyncAt).toLocaleString("ja-JP")}`
          : " まだサーバー保存履歴はありません。"}
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void inspect();
              }
            }}
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
      <label className="lp-check data-transfer-telemetry-setting">
        <input
          type="checkbox"
          checked={telemetryEnabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            setTelemetryEnabled(enabled);
            setBehaviorTelemetryEnabled(enabled);
          }}
        />
        匿名の利用状況計測に協力する
      </label>
      <p className="data-transfer-telemetry-note">
        ゲーム改善のため、画面表示や機能利用を匿名で集計します。入力内容・名前・正確なスコアは送信せず、成績は大まかな範囲だけを集計します。
      </p>
      {message && <p className="data-transfer-message" role="status">{message}</p>}

      {pending && (
        <div className="transfer-modal-backdrop" role="presentation">
          <section
            ref={modalRef}
            className="transfer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-compare-title"
            aria-describedby="transfer-restore-warning"
          >
            <p className="data-transfer-kicker">RESTORE CHECK</p>
            <h2 id="transfer-compare-title" ref={modalTitleRef} tabIndex={-1}>この記録で上書きしますか？</h2>
            <p id="transfer-restore-warning">
              自動マージは行いません。<strong>この端末の現在の記録は失われます。</strong>
            </p>
            <div className="transfer-compare">
              <SnapshotSummary label="この端末の記録" snapshot={pending.current} />
              <SnapshotSummary label="コード側の記録" snapshot={pending.snapshot} accent />
            </div>
            <div className="transfer-modal-actions">
              <button type="button" className="data-transfer-secondary" onClick={closeRestorePreview} disabled={busy === "restore"}>キャンセル</button>
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
