import {
  promptsFor,
  rankWeakChars,
  type CharPrompt,
  type PracticeMode,
} from "./numberSymbolPrompts";

/**
 * 数字・記号タイピング練習(D-092)。
 *
 * かな文の練習と違い、ここはローマ字の受理判定を使わない。
 * 打つ文字がそのままASCIIなので、1文字ずつの直接比較で足りる。
 * 独自価値は「どの数字・記号でミスしたか」を出すこと。
 */

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`数字記号練習: #${id} が見つかりません`);
  return element;
};

function format(value: number, digits = 0): string {
  return Number(value).toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const stage = byId("ns-stage") as HTMLDivElement;
const startButton = byId("ns-start") as HTMLButtonElement;
const resetButton = byId("ns-reset") as HTMLButtonElement;
const modeSelect = byId("ns-mode") as unknown as HTMLSelectElement;
const durationSelect = byId("ns-duration") as unknown as HTMLSelectElement;
const timeNode = byId("ns-time");
const labelNode = byId("ns-label");
const textNode = byId("ns-text");
const messageNode = byId("ns-message");
const result = byId("ns-result");
const cpmNode = byId("ns-cpm");
const accuracyNode = byId("ns-accuracy");
const correctNode = byId("ns-correct");
const weakNode = byId("ns-weak");

let running = false;
let prompts: readonly CharPrompt[] = promptsFor("number");
let promptIndex = 0;
let cursor = 0;
let correct = 0;
let misses = 0;
let startedAt = 0;
let duration = 60;
let timer: number | null = null;
const missByChar = new Map<string, number>();
const attemptByChar = new Map<string, number>();

function currentPrompt(): CharPrompt {
  return prompts[promptIndex % prompts.length]!;
}

/** 打ち終わった部分・現在位置・残りを塗り分ける */
function renderPrompt(): void {
  const prompt = currentPrompt();
  labelNode.textContent = prompt.label;
  textNode.textContent = "";

  const done = document.createElement("span");
  done.className = "done";
  done.textContent = prompt.text.slice(0, cursor);
  textNode.appendChild(done);

  const current = document.createElement("span");
  current.className = "current";
  // 空白は下線がないと現在位置が見えないため、記号で代替表示する
  current.textContent = prompt.text.charAt(cursor) === " " ? "␣" : prompt.text.charAt(cursor);
  textNode.appendChild(current);

  const rest = document.createElement("span");
  rest.className = "rest";
  rest.textContent = prompt.text.slice(cursor + 1);
  textNode.appendChild(rest);
}

function clearTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function renderWeakChars(): void {
  const ranked = rankWeakChars(missByChar, attemptByChar);
  weakNode.textContent = "";
  if (ranked.length === 0) {
    const none = document.createElement("p");
    none.textContent = "目立つ苦手文字はありませんでした。次は測定時間を延ばすか、記号モードを試してください。";
    weakNode.appendChild(none);
    return;
  }
  const list = document.createElement("ul");
  list.className = "weak-list";
  for (const row of ranked) {
    const item = document.createElement("li");
    const key = document.createElement("code");
    key.textContent = row.char === " " ? "スペース" : row.char;
    item.appendChild(key);
    const detail = document.createElement("span");
    detail.textContent = ` ミス${row.missCount}回（ミス率 ${format(row.rate * 100, 0)}%）`;
    item.appendChild(detail);
    list.appendChild(item);
  }
  weakNode.appendChild(list);
}

function finish(): void {
  if (!running) return;
  running = false;
  clearTimer();
  const elapsedMinutes = Math.max((performance.now() - startedAt) / 60000, 1 / 60);
  const accuracy = correct + misses === 0 ? 100 : (correct / (correct + misses)) * 100;
  cpmNode.textContent = format(correct / elapsedMinutes, 0);
  accuracyNode.textContent = `${format(accuracy, 1)}%`;
  correctNode.textContent = correct.toLocaleString();
  renderWeakChars();
  result.hidden = false;
  messageNode.textContent = "練習終了。苦手だった文字だけをもう一度打つと、短時間でも効きます。";
  startButton.textContent = "もう一度練習する";
}

function updateTime(): void {
  const remaining = Math.max(0, duration - (performance.now() - startedAt) / 1000);
  timeNode.textContent = remaining.toFixed(1);
  if (remaining <= 0) finish();
}

function start(): void {
  clearTimer();
  running = true;
  prompts = promptsFor(modeSelect.value as PracticeMode);
  promptIndex = 0;
  cursor = 0;
  correct = 0;
  misses = 0;
  missByChar.clear();
  attemptByChar.clear();
  duration = Number(durationSelect.value);
  startedAt = performance.now();
  result.hidden = true;
  messageNode.textContent = "IMEをOFF（半角英数）にして、表示された通りに打ってください。";
  startButton.textContent = "練習中";
  renderPrompt();
  updateTime();
  timer = window.setInterval(updateTime, 50);
  stage.focus();
}

function reset(): void {
  clearTimer();
  running = false;
  prompts = promptsFor(modeSelect.value as PracticeMode);
  promptIndex = 0;
  cursor = 0;
  correct = 0;
  misses = 0;
  missByChar.clear();
  attemptByChar.clear();
  timeNode.textContent = Number(durationSelect.value).toFixed(1);
  result.hidden = true;
  messageNode.textContent = "開始ボタンを押すと練習が始まります。";
  startButton.textContent = "練習を始める";
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

  const expected = currentPrompt().text.charAt(cursor);
  if (event.key !== expected) {
    misses += 1;
    missByChar.set(expected, (missByChar.get(expected) ?? 0) + 1);
    messageNode.textContent = `ミス ${misses}回。現在位置は進まないので、そのまま打ち直せます。`;
    return;
  }

  correct += 1;
  attemptByChar.set(expected, (attemptByChar.get(expected) ?? 0) + 1);
  cursor += 1;
  if (cursor >= currentPrompt().text.length) {
    promptIndex += 1;
    cursor = 0;
  }
  renderPrompt();
});

modeSelect.addEventListener("change", reset);
durationSelect.addEventListener("change", reset);
startButton.addEventListener("click", start);
resetButton.addEventListener("click", reset);
reset();
