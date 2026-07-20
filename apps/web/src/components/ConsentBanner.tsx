import { useEffect, useState } from "react";

const CONSENT_KEY = "typeblast.adConsent.v1";

export type ConsentState = "unknown" | "accepted" | "rejected";

export function loadConsent(): ConsentState {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (raw === "accepted" || raw === "rejected") return raw;
    return "unknown";
  } catch {
    return "unknown";
  }
}

function saveConsent(value: ConsentState): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // 保存失敗時は次回また尋ねる
  }
}

/**
 * 広告表示前の同意バナー。GDPR等の「同意なしに広告Cookieを読み込まない」原則に対応する。
 * 選択結果は localStorage に保存し、次回以降は再表示しない。
 */
export function ConsentBanner({ onChange }: { onChange: (state: ConsentState) => void }): JSX.Element | null {
  const [state, setState] = useState<ConsentState>(() => loadConsent());

  useEffect(() => {
    onChange(state);
    // 初回マウント時に現在の状態を親へ通知する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state !== "unknown") return null;

  const choose = (value: "accepted" | "rejected"): void => {
    saveConsent(value);
    setState(value);
    onChange(value);
  };

  return (
    <div className="consent-banner" role="dialog" aria-label="Cookie・広告に関する同意">
      <p className="consent-text">
        このサイトは広告表示のためCookieを使用する場合があります。同意いただける場合は「同意する」を押してください。
        同意しない場合も、ゲーム本体は引き続きご利用いただけます。
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          詳細(プライバシーポリシー)
        </a>
      </p>
      <div className="consent-buttons">
        <button className="btn-consent-accept" onClick={() => choose("accepted")}>
          同意する
        </button>
        <button className="btn-consent-reject" onClick={() => choose("rejected")}>
          同意しない
        </button>
      </div>
    </div>
  );
}
