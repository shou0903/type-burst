import { TypingAutomaton } from "@type-burst/typing-engine";
import {
  promptsForLevel,
  type SentencePracticeLevel,
  type SentencePracticePrompt,
} from "./sentencePrompts";

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`文章タイピング練習: #${id} が見つかりません`);
  return element;
};

const stage = byId("sentence-stage") as HTMLDivElement;
const startButton = byId("sentence-start") as HTMLButtonElement;
const resetButton = byId("sentence-reset") as HTMLButtonElement;
const levelSelect = byId("sentence-level") as unknown as HTMLSelectElement;
const countSelect = byId("sentence-count") as unknown as HTMLSelectElement;
const progressNode = byId("sentence-progress");
const elapsedNode = byId("sentence-elapsed");
const liveAccuracyNode = byId("sentence-live-accuracy");
const japaneseNode = byId("sentence-japanese");
const romanNode = byId("sentence-roman");
const messageNode = byId("sentence-message");
const resultNode = byId("sentence-result");
const resultTimeNode = byId("sentence-result-time");
const resultKpmNode = byId("sentence-result-kpm");
const resultAccuracyNode = byId("sentence-result-accuracy");
const resultMissesNode = byId("sentence-result-misses");

let running = false;
let prompts: readonly SentencePracticePrompt[] = promptsForLevel("beginner");
let promptIndex = 0;
let targetCount = 5;
let correct = 0;
let misses = 0;
let startedAt = 0;
let timer: number | null = null;
let automaton = new TypingAutomaton(prompts[0]!.reading);

function format(value: number, digits = 0): string {
  return value.toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function currentPrompt(): SentencePracticePrompt {
  return prompts[promptIndex % prompts.length]!;
}

function elapsedSeconds(): number {
  return running ? Math.max(0, (performance.now() - startedAt) / 1000) : 0;
}

function accuracy(): number {
  return correct + misses === 0 ? 100 : (correct / (correct + misses)) * 100;
}

function clearTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function renderPrompt(): void {
  japaneseNode.textContent = currentPrompt().ja;
  romanNode.textContent = "";

  const typed = automaton.getTypedRomaji();
  if (typed) {
    const done = document.createElement("span");
    done.className = "done";
    done.textContent = typed;
    romanNode.appendChild(done);
  }

  if (!automaton.isAccepted()) {
    const next = document.createElement("span");
    next.className = "current";
    next.textContent = `${typed ? " 次" : "最初"}: ${automaton.getExpectedKeys().join(" / ")}`;
    romanNode.appendChild(next);

    const hint = document.createElement("span");
    hint.className = "rest";
    hint.textContent = "（正しい別表記にも対応）";
    romanNode.appendChild(hint);
  }
}

function renderStatus(): void {
  progressNode.textContent = `${Math.min(promptIndex + 1, targetCount)} / ${targetCount}`;
  elapsedNode.textContent = format(elapsedSeconds(), 1);
  liveAccuracyNode.textContent = `${format(accuracy(), 1)}%`;
}

function finish(): void {
  if (!running) return;
  const totalSeconds = Math.max((performance.now() - startedAt) / 1000, 1);
  running = false;
  clearTimer();

  const kpm = correct / (totalSeconds / 60);
  resultTimeNode.textContent = `${format(totalSeconds, 1)}秒`;
  resultKpmNode.textContent = format(kpm);
  resultAccuracyNode.textContent = `${format(accuracy(), 1)}%`;
  resultMissesNode.textContent = misses.toLocaleString("ja-JP");
  resultNode.hidden = false;
  progressNode.textContent = `${targetCount} / ${targetCount}`;
  elapsedNode.textContent = format(totalSeconds, 1);
  messageNode.textContent = "練習完了。同じレベルで再挑戦すると、速度と正確率を同じ条件で比べられます。";
  startButton.textContent = "同じ条件でもう一度";
}

function start(): void {
  clearTimer();
  const level = levelSelect.value as SentencePracticeLevel;
  prompts = promptsForLevel(level);
  targetCount = Math.min(Number(countSelect.value), prompts.length);
  promptIndex = 0;
  correct = 0;
  misses = 0;
  automaton = new TypingAutomaton(currentPrompt().reading);
  startedAt = performance.now();
  running = true;
  resultNode.hidden = true;
  startButton.textContent = "練習中";
  messageNode.textContent = "IMEをOFFにして入力してください。ミスしても入力済みの文字は消えません。";
  renderPrompt();
  renderStatus();
  timer = window.setInterval(renderStatus, 100);
  stage.focus();
}

function reset(): void {
  clearTimer();
  running = false;
  prompts = promptsForLevel(levelSelect.value as SentencePracticeLevel);
  targetCount = Math.min(Number(countSelect.value), prompts.length);
  promptIndex = 0;
  correct = 0;
  misses = 0;
  automaton = new TypingAutomaton(currentPrompt().reading);
  progressNode.textContent = `1 / ${targetCount}`;
  elapsedNode.textContent = "0.0";
  liveAccuracyNode.textContent = "100.0%";
  resultNode.hidden = true;
  startButton.textContent = "文章練習を始める";
  messageNode.textContent = "レベルと文数を選び、開始ボタンを押してください。";
  renderPrompt();
}

stage.addEventListener("keydown", (event) => {
  if (!running || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  event.preventDefault();

  const feed = automaton.feed(event.key.toLowerCase());
  if (!feed.accepted) {
    misses += 1;
    messageNode.textContent = `ミス ${misses}回。途中までの入力は残っているので、そのまま続けられます。`;
    renderStatus();
    return;
  }

  correct += 1;
  if (feed.completed) {
    promptIndex += 1;
    if (promptIndex >= targetCount) {
      finish();
      return;
    }
    automaton = new TypingAutomaton(currentPrompt().reading);
    messageNode.textContent = `${promptIndex}文完了。次の文章へ進みます。`;
  }

  renderPrompt();
  renderStatus();
});

startButton.addEventListener("click", start);
resetButton.addEventListener("click", reset);
levelSelect.addEventListener("change", reset);
countSelect.addEventListener("change", reset);
reset();
