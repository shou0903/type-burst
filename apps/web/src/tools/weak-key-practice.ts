import { TypingAutomaton } from "@type-burst/typing-engine";
import {
  KEYBOARD_ROWS,
  buildWeakKeyPromptMap,
  type WeakKeyPrompt,
} from "./weakKeyPrompts";

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`苦手キー練習: #${id} が見つかりません`);
  return element;
};

const keyboard = byId("weak-key-keyboard");
const selectedNode = byId("weak-key-selected");
const availabilityNode = byId("weak-key-availability");
const stage = byId("weak-key-stage") as HTMLDivElement;
const japaneseNode = byId("weak-key-japanese");
const exampleNode = byId("weak-key-example");
const romanNode = byId("weak-key-roman");
const messageNode = byId("weak-key-message");
const wordCountNode = byId("weak-key-word-count");
const hitCountNode = byId("weak-key-hit-count");
const liveAccuracyNode = byId("weak-key-live-accuracy");
const startButton = byId("weak-key-start") as HTMLButtonElement;
const resetButton = byId("weak-key-reset") as HTMLButtonElement;
const resultNode = byId("weak-key-result");
const resultWordsNode = byId("weak-key-result-words");
const resultHitsNode = byId("weak-key-result-hits");
const resultAccuracyNode = byId("weak-key-result-accuracy");
const resultMissesNode = byId("weak-key-result-misses");

const promptMap = buildWeakKeyPromptMap();

let selectedKey = "r";
let prompts = promptMap.get(selectedKey) ?? [];
let promptIndex = 0;
let automaton = new TypingAutomaton(prompts[0]!.readingKana);
let running = false;
let locked = false;
let completedWords = 0;
let correct = 0;
let misses = 0;
let targetHits = 0;
let targetHitsInWord = 0;
const sessionLength = 10;

function formatAccuracy(): string {
  const total = correct + misses;
  return `${(total === 0 ? 100 : (correct / total) * 100).toFixed(1)}%`;
}

function currentPrompt(): WeakKeyPrompt {
  return prompts[promptIndex % prompts.length]!;
}

function renderExample(prompt: WeakKeyPrompt): void {
  exampleNode.textContent = "";
  for (const character of prompt.canonicalRomaji) {
    if (character === selectedKey) {
      const mark = document.createElement("mark");
      mark.textContent = character;
      exampleNode.appendChild(mark);
    } else {
      exampleNode.append(character);
    }
  }
}

function renderPrompt(): void {
  const prompt = currentPrompt();
  japaneseNode.textContent = prompt.displayText;
  renderExample(prompt);
  const typed = automaton.getTypedRomaji();
  const expected = automaton.getExpectedKeys();
  romanNode.textContent = "";

  if (typed) {
    const done = document.createElement("span");
    done.className = "done";
    done.textContent = typed;
    romanNode.appendChild(done);
  }

  if (!automaton.isAccepted()) {
    const next = document.createElement("span");
    next.className = "current";
    next.textContent = typed ? ` 次: ${expected.join(" / ")}` : `次: ${expected.join(" / ")}`;
    romanNode.appendChild(next);
  }
}

function updateMetrics(): void {
  wordCountNode.textContent = `${completedWords} / ${sessionLength}`;
  hitCountNode.textContent = targetHits.toLocaleString("ja-JP");
  liveAccuracyNode.textContent = formatAccuracy();
}

function finish(): void {
  running = false;
  locked = false;
  resultWordsNode.textContent = completedWords.toLocaleString("ja-JP");
  resultHitsNode.textContent = targetHits.toLocaleString("ja-JP");
  resultAccuracyNode.textContent = formatAccuracy();
  resultMissesNode.textContent = misses.toLocaleString("ja-JP");
  resultNode.hidden = false;
  startButton.textContent = "もう一度練習";
  messageNode.textContent =
    targetHits > 0
      ? `${selectedKey.toUpperCase()}キーを${targetHits}回、正しく入力しました。`
      : `入力例の${selectedKey.toUpperCase()}を意識して、もう一度試しましょう。`;
}

function advancePrompt(): void {
  completedWords += 1;
  updateMetrics();
  if (completedWords >= sessionLength) {
    finish();
    return;
  }
  promptIndex = (promptIndex + 1) % prompts.length;
  automaton = new TypingAutomaton(currentPrompt().readingKana);
  targetHitsInWord = 0;
  locked = false;
  renderPrompt();
  messageNode.textContent = `${selectedKey.toUpperCase()}キーを力まず、元の位置へ指を戻します。`;
}

function resetSession(): void {
  running = false;
  locked = false;
  promptIndex = 0;
  completedWords = 0;
  correct = 0;
  misses = 0;
  targetHits = 0;
  targetHitsInWord = 0;
  automaton = new TypingAutomaton(currentPrompt().readingKana);
  resultNode.hidden = true;
  startButton.textContent = "10語の練習を始める";
  messageNode.textContent = "開始ボタンを押し、表示された日本語をローマ字で入力します。";
  renderPrompt();
  updateMetrics();
}

function selectKey(key: string): void {
  const nextPrompts = promptMap.get(key) ?? [];
  if (nextPrompts.length === 0) return;
  selectedKey = key;
  prompts = nextPrompts;
  selectedNode.textContent = key.toUpperCase();
  availabilityNode.textContent = `${prompts.length.toLocaleString("ja-JP")}語から出題`;
  for (const button of keyboard.querySelectorAll<HTMLButtonElement>("[data-key]")) {
    button.classList.toggle("is-selected", button.dataset.key === key);
    button.setAttribute("aria-pressed", button.dataset.key === key ? "true" : "false");
  }
  resetSession();
}

for (const row of KEYBOARD_ROWS) {
  const rowNode = document.createElement("div");
  rowNode.className = "practice-key-row";
  for (const key of row) {
    const available = (promptMap.get(key)?.length ?? 0) > 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "practice-key";
    button.textContent = key.toUpperCase();
    button.dataset.key = key;
    button.disabled = !available;
    button.setAttribute("aria-label", available ? `${key.toUpperCase()}キーを練習` : `${key.toUpperCase()}キーは対象外`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectKey(key));
    rowNode.appendChild(button);
  }
  keyboard.appendChild(rowNode);
}

stage.addEventListener("keydown", (event) => {
  if (!running || locked || event.ctrlKey || event.metaKey || event.altKey) return;
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
    messageNode.textContent = "ミスしても入力途中は消えません。そのまま正しいキーを続けてください。";
    updateMetrics();
    return;
  }

  correct += 1;
  if (input === selectedKey) {
    targetHits += 1;
    targetHitsInWord += 1;
  }
  renderPrompt();
  updateMetrics();

  if (feed.completed) {
    locked = true;
    messageNode.textContent =
      targetHitsInWord > 0
        ? `${selectedKey.toUpperCase()}キーを${targetHitsInWord}回入力できました。`
        : `別表記で完了しました。次は入力例の${selectedKey.toUpperCase()}も試せます。`;
    window.setTimeout(advancePrompt, 180);
  }
});

startButton.addEventListener("click", () => {
  resetSession();
  running = true;
  startButton.textContent = "練習中";
  messageNode.textContent = `入力例で色の付いた${selectedKey.toUpperCase()}キーを意識しましょう。別の正しいローマ字表記も受け付けます。`;
  stage.focus();
});
resetButton.addEventListener("click", resetSession);
selectKey(selectedKey);
