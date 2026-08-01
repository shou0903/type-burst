import { track } from "@vercel/analytics";
import {
  enumerateRomajiCandidates,
  normalizeKana,
  TypingAutomaton,
  type RomajiCandidateResult,
} from "@type-burst/typing-engine";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`ローマ字入力ラボ: #${id} が見つかりません`);
  return element as T;
};

type DrillCategory = "n" | "sokuon" | "small" | "foreign" | "mixed";

interface DrillPrompt {
  reading: string;
  label: string;
}

const drillPrompts: Record<DrillCategory, readonly DrillPrompt[]> = {
  n: [
    { reading: "かんじ", label: "漢字" },
    { reading: "あんない", label: "案内" },
    { reading: "ほん", label: "本" },
    { reading: "でんわ", label: "電話" },
    { reading: "しんよう", label: "信用" },
  ],
  sokuon: [
    { reading: "きって", label: "切手" },
    { reading: "がっこう", label: "学校" },
    { reading: "ざっし", label: "雑誌" },
    { reading: "いっぱい", label: "いっぱい" },
    { reading: "けっか", label: "結果" },
  ],
  small: [
    { reading: "しゃしん", label: "写真" },
    { reading: "りょこう", label: "旅行" },
    { reading: "にゅうりょく", label: "入力" },
    { reading: "じゅぎょう", label: "授業" },
    { reading: "ふぁいる", label: "ファイル" },
  ],
  foreign: [
    { reading: "てぃー", label: "ティー" },
    { reading: "でぃすぷれい", label: "ディスプレイ" },
    { reading: "とぅーる", label: "トゥール" },
    { reading: "うぇぶ", label: "ウェブ" },
    { reading: "ヴぁいおりん", label: "ヴァイオリン" },
  ],
  mixed: [
    { reading: "きょうはいいてんき", label: "今日はいい天気" },
    { reading: "しゅっぱつじかん", label: "出発時間" },
    { reading: "にゅうりょくをかくにん", label: "入力を確認" },
    { reading: "あんないをよむ", label: "案内を読む" },
    { reading: "でぃすぷれいをみる", label: "ディスプレイを見る" },
  ],
};

const form = byId<HTMLFormElement>("romaji-form");
const input = byId<HTMLInputElement>("romaji-input");
const errorNode = byId<HTMLParagraphElement>("romaji-error");
const resultNode = byId<HTMLElement>("romaji-result");
const resultReadingNode = byId<HTMLElement>("result-reading");
const resultSummaryNode = byId<HTMLParagraphElement>("result-summary");
const resultTruncatedNode = byId<HTMLElement>("result-truncated");
const candidateListNode = byId<HTMLElement>("candidate-list");
const practiceNode = byId<HTMLElement>("romaji-practice");
const practiceStage = byId<HTMLDivElement>("practice-stage");
const practiceJapaneseNode = byId<HTMLElement>("practice-japanese");
const practiceRomanNode = byId<HTMLElement>("practice-roman");
const practiceMessageNode = byId<HTMLParagraphElement>("practice-message");
const practiceProgressNode = byId<HTMLElement>("practice-progress");
const practiceStartButton = byId<HTMLButtonElement>("practice-start");
const practiceResetButton = byId<HTMLButtonElement>("practice-reset");

const drillStage = byId<HTMLDivElement>("drill-stage");
const drillJapaneseNode = byId<HTMLElement>("drill-japanese");
const drillRomanNode = byId<HTMLElement>("drill-roman");
const drillMessageNode = byId<HTMLParagraphElement>("drill-message");
const drillTimeNode = byId<HTMLElement>("drill-time");
const drillCountNode = byId<HTMLElement>("drill-count");
const drillMissesNode = byId<HTMLElement>("drill-misses");
const drillStartButton = byId<HTMLButtonElement>("drill-start");
const drillResetButton = byId<HTMLButtonElement>("drill-reset");

let latestReading = "";
let latestCandidates: readonly string[] = [];
let practiceAutomaton: TypingAutomaton | null = null;
let practiceRunning = false;
let practiceCandidate = "";

let selectedDrill: DrillCategory = "n";
let drillPromptsForSession = drillPrompts[selectedDrill];
let drillIndex = 0;
let drillAutomaton = new TypingAutomaton(drillPromptsForSession[0]!.reading);
let drillRunning = false;
let drillStartedAt = 0;
let drillTimer: number | null = null;
let drillCompleted = 0;
let drillMisses = 0;

function safeTrack(name: string, properties: Record<string, string | number>): void {
  try {
    track(name, properties);
  } catch {
    // 分析の失敗は、入力ラボの操作を妨げない。
  }
}

function categoryFor(reading: string): string {
  if (reading.includes("ん")) return "n";
  if (reading.includes("っ")) return "sokuon";
  if (/[ぁぃぅぇぉゃゅょゎ]/u.test(reading)) return "small-kana";
  if (/[てでとどふうゔ][ぃぅ]/u.test(reading) || reading.includes("ふぁ") || reading.includes("うぇ")) return "foreign-sound";
  return "other";
}

function isSupportedKana(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (!((code >= 0x3041 && code <= 0x3096) || character === "ー")) return false;
  }
  return value.length > 0;
}

function validateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "かなを入力してください。例：かんじ、きって、ティー";
  if ([...trimmed].length > 40) return "入力できる長さは40文字までです。短いかな列で試してください。";
  const normalized = normalizeKana(trimmed);
  if (!isSupportedKana(normalized)) return "ひらがな・カタカナ・長音記号（ー）のみ対応しています。漢字は読み方をかなで入力してください。";
  return null;
}

function formatCandidate(candidate: string): string {
  return candidate.replaceAll("'", "’");
}

function renderTyping(romanNode: HTMLElement, automaton: TypingAutomaton): void {
  romanNode.textContent = "";
  const typed = automaton.getTypedRomaji();
  if (typed) {
    const done = document.createElement("span");
    done.className = "done";
    done.textContent = typed;
    romanNode.appendChild(done);
  }
  if (automaton.isAccepted()) {
    const complete = document.createElement("span");
    complete.className = "done";
    complete.textContent = " 完了";
    romanNode.appendChild(complete);
    return;
  }
  const next = document.createElement("span");
  next.className = "current";
  next.textContent = `${typed ? " 次" : "次"}: ${automaton.getExpectedKeys().join(" / ")}`;
  romanNode.appendChild(next);
}

function resetPractice(): void {
  practiceRunning = false;
  practiceCandidate = latestCandidates[0] ?? "";
  practiceAutomaton = latestReading ? new TypingAutomaton(latestReading) : null;
  practiceStartButton.textContent = "試打を始める";
  practiceMessageNode.textContent = "開始ボタンを押して入力します。";
  practiceProgressNode.textContent = "0%";
  practiceJapaneseNode.textContent = latestReading;
  if (practiceAutomaton) renderTyping(practiceRomanNode, practiceAutomaton);
}

function selectPracticeCandidate(candidate: string): void {
  if (!latestReading) return;
  practiceCandidate = candidate;
  practiceAutomaton = new TypingAutomaton(latestReading);
  practiceRunning = false;
  practiceStartButton.textContent = "試打を始める";
  practiceProgressNode.textContent = "0%";
  practiceMessageNode.textContent = `候補「${formatCandidate(candidate)}」を使って試します。`;
  renderTyping(practiceRomanNode, practiceAutomaton);
  practiceNode.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderCandidates(result: RomajiCandidateResult): void {
  latestReading = result.normalizedReading;
  latestCandidates = result.candidates;
  resultReadingNode.textContent = result.normalizedReading;
  resultTruncatedNode.hidden = !result.truncated;
  const recommended = new TypingAutomaton(result.normalizedReading).getCanonicalRomaji();
  const shortest = [...result.candidates].sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? recommended;
  const shortestIsDifferent = shortest !== recommended;
  resultSummaryNode.textContent = result.candidates.length > 0
    ? `おすすめは ${formatCandidate(recommended)}。${shortestIsDifferent ? `最短候補は ${formatCandidate(shortest)} です。` : "表示された候補は同じ長さです。"}`
    : "このかな列に対応する候補を見つけられませんでした。";

  candidateListNode.textContent = "";
  for (const candidate of result.candidates) {
    const card = document.createElement("article");
    card.className = "candidate-card";
    if (candidate === recommended) card.classList.add("is-recommended");

    const meta = document.createElement("div");
    meta.className = "candidate-meta";
    if (candidate === recommended) {
      const badge = document.createElement("span");
      badge.className = "candidate-badge primary";
      badge.textContent = "おすすめ";
      meta.appendChild(badge);
    }
    if (candidate === shortest && shortestIsDifferent) {
      const badge = document.createElement("span");
      badge.className = "candidate-badge";
      badge.textContent = "最短";
      meta.appendChild(badge);
    }

    const code = document.createElement("code");
    code.className = "candidate-romaji";
    code.textContent = formatCandidate(candidate);

    const use = document.createElement("button");
    use.type = "button";
    use.className = "candidate-use";
    use.textContent = "この候補で試す →";
    use.addEventListener("click", () => selectPracticeCandidate(candidate));

    card.appendChild(meta);
    card.appendChild(code);
    card.appendChild(use);
    candidateListNode.appendChild(card);
  }
  resultNode.hidden = false;
  practiceNode.hidden = result.candidates.length === 0;
  resetPractice();
  safeTrack("Romaji Lab Lookup", { category: categoryFor(result.normalizedReading), candidateCount: result.candidates.length });
}

function lookup(value: string): void {
  errorNode.hidden = true;
  resultNode.hidden = true;
  practiceNode.hidden = true;
  const validationError = validateInput(value);
  if (validationError) {
    errorNode.textContent = validationError;
    errorNode.hidden = false;
    return;
  }
  try {
    const result = enumerateRomajiCandidates(value, { maxCandidates: 8 });
    renderCandidates(result);
  } catch (error) {
    errorNode.textContent = error instanceof Error ? error.message : "この入力は確認できませんでした。";
    errorNode.hidden = false;
  }
}

function handlePracticeKey(event: KeyboardEvent): void {
  if (!practiceRunning || !practiceAutomaton || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length !== 1) return;
  event.preventDefault();
  const feed = practiceAutomaton.feed(event.key.toLowerCase());
  if (!feed.accepted) {
    practiceMessageNode.textContent = "ミスしても入力途中は消えません。そのまま正しいキーを続けてください。";
    return;
  }
  practiceProgressNode.textContent = `${Math.round(practiceAutomaton.getProgress() * 100)}%`;
  renderTyping(practiceRomanNode, practiceAutomaton);
  if (feed.completed) {
    practiceRunning = false;
    practiceStartButton.textContent = "もう一度試す";
    practiceMessageNode.textContent = `完了。${formatCandidate(practiceCandidate)} はTYPE BURSTで受理される入力です。`;
    safeTrack("Romaji Lab Practice", { category: categoryFor(latestReading), completed: 1 });
  }
}

function currentDrillPrompt(): DrillPrompt {
  return drillPromptsForSession[drillIndex % drillPromptsForSession.length]!;
}

function renderDrillPrompt(): void {
  const prompt = currentDrillPrompt();
  drillJapaneseNode.textContent = prompt.label;
  renderTyping(drillRomanNode, drillAutomaton);
  drillCountNode.textContent = String(drillCompleted);
  drillMissesNode.textContent = String(drillMisses);
}

function clearDrillTimer(): void {
  if (drillTimer !== null) window.clearInterval(drillTimer);
  drillTimer = null;
}

function finishDrill(): void {
  if (!drillRunning) return;
  drillRunning = false;
  clearDrillTimer();
  drillTimeNode.textContent = "0";
  drillStartButton.textContent = "もう一度ドリル";
  drillMessageNode.textContent = `${drillCompleted}問完了。ミスしても入力途中は残るので、正確さを保ったまま続けてみましょう。`;
  safeTrack("Romaji Lab Drill Complete", { category: selectedDrill, completed: drillCompleted, misses: drillMisses });
}

function updateDrillTime(): void {
  const remaining = Math.max(0, 20 - (performance.now() - drillStartedAt) / 1000);
  drillTimeNode.textContent = remaining.toFixed(1);
  if (remaining <= 0) finishDrill();
}

function resetDrill(): void {
  clearDrillTimer();
  drillRunning = false;
  drillIndex = 0;
  drillCompleted = 0;
  drillMisses = 0;
  drillTimeNode.textContent = "20";
  drillStartButton.textContent = "20秒ドリルを始める";
  drillPromptsForSession = drillPrompts[selectedDrill];
  drillAutomaton = new TypingAutomaton(drillPromptsForSession[0]!.reading);
  drillMessageNode.textContent = "課題を選び、開始ボタンを押してください。";
  renderDrillPrompt();
}

function handleDrillKey(event: KeyboardEvent): void {
  if (!drillRunning || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length !== 1) return;
  event.preventDefault();
  const feed = drillAutomaton.feed(event.key.toLowerCase());
  if (!feed.accepted) {
    drillMisses += 1;
    drillMissesNode.textContent = String(drillMisses);
    drillMessageNode.textContent = "ミスしても入力途中は消えません。正しいキーを続けてください。";
    return;
  }
  renderDrillPrompt();
  if (!feed.completed) return;
  drillCompleted += 1;
  drillIndex += 1;
  drillAutomaton = new TypingAutomaton(currentDrillPrompt().reading);
  drillMessageNode.textContent = `${drillCompleted}問完了。次の課題へ進みます。`;
  renderDrillPrompt();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(input.value);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-example]")) {
  button.addEventListener("click", () => {
    input.value = button.dataset.example ?? "";
    lookup(input.value);
    input.focus();
  });
}

practiceStage.addEventListener("keydown", handlePracticeKey);
practiceStartButton.addEventListener("click", () => {
  if (!practiceAutomaton) return;
  practiceRunning = true;
  practiceStartButton.textContent = "入力中";
  practiceMessageNode.textContent = "表示された候補を入力してください。IMEはOFFにします。";
  practiceStage.focus();
});
practiceResetButton.addEventListener("click", resetPractice);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-drill]")) {
  button.addEventListener("click", () => {
    const category = button.dataset.drill as DrillCategory | undefined;
    if (!category || !(category in drillPrompts)) return;
    selectedDrill = category;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-drill]")) {
      candidate.classList.toggle("is-selected", candidate === button);
    }
    resetDrill();
  });
}

drillStage.addEventListener("keydown", handleDrillKey);
drillStartButton.addEventListener("click", () => {
  resetDrill();
  drillRunning = true;
  drillStartedAt = performance.now();
  drillStartButton.textContent = "ドリル中";
  drillMessageNode.textContent = "表示された課題をローマ字で入力してください。";
  updateDrillTime();
  drillTimer = window.setInterval(updateDrillTime, 100);
  drillStage.focus();
});
drillResetButton.addEventListener("click", resetDrill);

resetDrill();
