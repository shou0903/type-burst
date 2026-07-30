import { adviseInputMethod, type CurrentMethod } from "./inputMethodAdvice";

/** かな入力／ローマ字入力 判定(D-092)。判定ロジックは inputMethodAdvice.ts に分離する。 */

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`入力方式判定: #${id} が見つかりません`);
  return element;
};

const methodSelect = byId("im-method") as unknown as HTMLSelectElement;
const kpmInput = byId("im-kpm") as unknown as HTMLInputElement;
const latinInput = byId("im-latin") as unknown as HTMLInputElement;
const sharedInput = byId("im-shared") as unknown as HTMLInputElement;
const runButton = byId("im-run") as HTMLButtonElement;
const result = byId("im-result");
const verdictNode = byId("im-verdict");
const reasonNode = byId("im-reason");
const actionNode = byId("im-action");
const caveatNode = byId("im-caveat");
const linkNode = byId("im-link") as HTMLAnchorElement;

function readKpm(): number | null {
  const raw = kpmInput.value.trim();
  if (raw === "") return null;
  const value = Number(raw);
  // 負値や非現実的な値は「未測定」として扱い、誤った判定を返さない
  if (!Number.isFinite(value) || value <= 0 || value > 1500) return null;
  return value;
}

function run(): void {
  const advice = adviseInputMethod({
    current: methodSelect.value as CurrentMethod,
    kpm: readKpm(),
    typesLatin: latinInput.checked,
    sharesDevices: sharedInput.checked,
  });
  verdictNode.textContent = advice.verdict;
  reasonNode.textContent = advice.reason;
  actionNode.textContent = advice.action;
  caveatNode.textContent = advice.caveat;
  linkNode.href = advice.linkHref;
  linkNode.textContent = advice.linkLabel;
  result.hidden = false;
}

runButton.addEventListener("click", run);
kpmInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") run();
});
