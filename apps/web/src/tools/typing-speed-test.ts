import { TypingAutomaton } from "@type-burst/typing-engine";
import { SPEED_TEST_PROMPTS } from "./speedPrompts";

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`速度測定: #${id} が見つかりません`);
  return element;
};

function format(value: number, digits = 0): string {
  return Number(value).toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const stage = byId("typing-test") as HTMLDivElement;
const startButton = byId("typing-start") as HTMLButtonElement;
const resetButton = byId("typing-reset") as HTMLButtonElement;
const durationSelect = byId("typing-duration") as unknown as HTMLSelectElement;
const timeNode = byId("typing-time");
const japaneseNode = byId("typing-japanese");
const romanNode = byId("typing-roman");
const messageNode = byId("typing-message");
const result = byId("typing-result");
const kpmNode = byId("typing-kpm");
const wpmNode = byId("typing-wpm");
const accuracyNode = byId("typing-accuracy");
const correctNode = byId("typing-correct");

let running = false;
let promptIndex = 0;
let automaton = new TypingAutomaton(SPEED_TEST_PROMPTS[0]!.reading);
let correct = 0;
let misses = 0;
let startedAt = 0;
let duration = 60;
let timer: number | null = null;

function currentPrompt() {
  return SPEED_TEST_PROMPTS[promptIndex % SPEED_TEST_PROMPTS.length]!;
}

function renderPrompt(): void {
  const prompt = currentPrompt();
  japaneseNode.textContent = prompt.ja;

  const typed = automaton.getTypedRomaji();
  const expected = automaton.getExpectedKeys();
  romanNode.textContent = "";

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
  next.textContent = typed ? ` 次: ${expected.join(" / ")}` : `次: ${expected.join(" / ")}`;
  romanNode.appendChild(next);

  const hint = document.createElement("span");
  hint.className = "rest";
  hint.textContent = "（複数のローマ字入力に対応）";
  romanNode.appendChild(hint);
}

function clearTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function finish(): void {
  if (!running) return;
  running = false;
  clearTimer();
  const elapsedMinutes = Math.max((performance.now() - startedAt) / 60000, 1 / 60);
  const kpm = correct / elapsedMinutes;
  const accuracy = correct + misses === 0 ? 100 : (correct / (correct + misses)) * 100;
  kpmNode.textContent = format(kpm, 0);
  wpmNode.textContent = format(kpm / 5, 1);
  accuracyNode.textContent = `${format(accuracy, 1)}%`;
  correctNode.textContent = correct.toLocaleString();
  result.hidden = false;
  messageNode.textContent = "測定完了。複数のローマ字入力を使った場合も、正しい打鍵として集計しています。";
  startButton.textContent = "もう一度測る";
}

function updateTime(): void {
  const elapsed = (performance.now() - startedAt) / 1000;
  const remaining = Math.max(0, duration - elapsed);
  timeNode.textContent = remaining.toFixed(1);
  if (remaining <= 0) finish();
}

function start(): void {
  clearTimer();
  running = true;
  promptIndex = 0;
  automaton = new TypingAutomaton(currentPrompt().reading);
  correct = 0;
  misses = 0;
  duration = Number(durationSelect.value);
  startedAt = performance.now();
  result.hidden = true;
  messageNode.textContent = "IMEをOFFにして入力してください。shi / si / chi / ti など、ゲーム本体と同じ別表記を受け付けます。";
  startButton.textContent = "測定中";
  renderPrompt();
  updateTime();
  timer = window.setInterval(updateTime, 50);
  stage.focus();
}

function reset(): void {
  clearTimer();
  running = false;
  promptIndex = 0;
  automaton = new TypingAutomaton(currentPrompt().reading);
  correct = 0;
  misses = 0;
  timeNode.textContent = Number(durationSelect.value).toFixed(1);
  result.hidden = true;
  messageNode.textContent = "開始ボタンを押すと測定が始まります。複数のローマ字入力に対応しています。";
  startButton.textContent = "測定を始める";
  renderPrompt();
}

stage.addEventListener("keydown", (event) => {
  if (!running || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finish();
    return;
  }
  if (event.key.length !== 1) return;
  event.preventDefault();

  const input = event.key.toLowerCase();
  const feed = automaton.feed(input);
  if (!feed.accepted) {
    misses += 1;
    messageNode.textContent = `ミス ${misses}回。入力済みの文字は残るので、そのまま続けられます。`;
    return;
  }

  correct += 1;
  if (feed.completed) {
    promptIndex += 1;
    automaton = new TypingAutomaton(currentPrompt().reading);
  }
  renderPrompt();
});

startButton.addEventListener("click", start);
resetButton.addEventListener("click", reset);
durationSelect.addEventListener("change", reset);
reset();
