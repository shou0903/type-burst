const byId = (id) => document.getElementById(id);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function format(value, digits = 0) {
  return Number(value).toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function setupConverter() {
  const form = byId("converter-form");
  if (!form) return;
  const source = byId("converter-source");
  const value = byId("converter-value");
  const result = byId("converter-result");
  const headline = byId("converter-headline");
  const detail = byId("converter-detail");

  const calculate = () => {
    const input = Number(value.value);
    if (!Number.isFinite(input) || input < 0) {
      result.hidden = true;
      return;
    }
    const fromKpm = source.value === "kpm";
    const kpm = fromKpm ? input : input * 5;
    const wpm = fromKpm ? input / 5 : input;
    headline.textContent = fromKpm ? `${format(wpm, 1)} WPM` : `${format(kpm, 0)} KPM`;
    detail.textContent = `${format(kpm, 0)} KPM ≒ ${format(wpm, 1)} WPM（1語＝5打鍵の一般的な換算）`;
    result.hidden = false;
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  source.addEventListener("change", calculate);
  value.addEventListener("input", calculate);
  calculate();
}

function setupAccuracy() {
  const form = byId("accuracy-form");
  if (!form) return;
  const correct = byId("accuracy-correct");
  const misses = byId("accuracy-misses");
  const result = byId("accuracy-result");
  const headline = byId("accuracy-headline");
  const detail = byId("accuracy-detail");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const correctCount = Math.max(0, Number(correct.value));
    const missCount = Math.max(0, Number(misses.value));
    const total = correctCount + missCount;
    if (!Number.isFinite(total) || total <= 0) {
      result.hidden = true;
      return;
    }
    const accuracy = (correctCount / total) * 100;
    let diagnosis = "まずは速度を抑え、正確な指運びを作る段階です。";
    if (accuracy >= 98) diagnosis = "高い正確性です。正確率を保ったまま少しずつ速度を上げられます。";
    else if (accuracy >= 95) diagnosis = "安定しています。繰り返すミスのキーを1つだけ直すと伸びやすい状態です。";
    else if (accuracy >= 90) diagnosis = "急ぎすぎの可能性があります。5〜10％だけ速度を落として再測定しましょう。";
    headline.textContent = `${format(accuracy, 1)}%`;
    detail.textContent = `${total.toLocaleString()}打鍵中 ${missCount.toLocaleString()}ミス。${diagnosis}`;
    result.hidden = false;
  });
}

const prompts = [
  { ja: "今日は集中して練習する", romaji: "kyouhashuuchuushiterenshuusuru" },
  { ja: "正確さを保って少しずつ速く", romaji: "seikakusawotamottesukoshizutsuhayaku" },
  { ja: "ホームポジションへ指を戻す", romaji: "hoomupojishonheyubiwomodosu" },
  { ja: "ミスの原因を一つずつ直す", romaji: "misunogenninwohitotsuzutsunaosu" },
  { ja: "毎日の短い反復が力になる", romaji: "mainichinomijikahanpukugachikaraninaru" },
  { ja: "画面を見ながら一定のリズムで打つ", romaji: "gamenwominagaraichiteinorizumudeutsu" },
  { ja: "焦らず滑らかな入力を目指す", romaji: "aserazunamerakananyuuryokuwomezasu" },
  { ja: "タイピングと連鎖パズルを楽しむ", romaji: "taipingutorensapazuruwotanoshimu" },
];

function setupSpeedTest() {
  const stage = byId("typing-test");
  if (!stage) return;
  const startButton = byId("typing-start");
  const resetButton = byId("typing-reset");
  const durationSelect = byId("typing-duration");
  const timeNode = byId("typing-time");
  const jaNode = byId("typing-japanese");
  const romanNode = byId("typing-roman");
  const messageNode = byId("typing-message");
  const result = byId("typing-result");
  const kpmNode = byId("typing-kpm");
  const wpmNode = byId("typing-wpm");
  const accuracyNode = byId("typing-accuracy");
  const correctNode = byId("typing-correct");

  let running = false;
  let promptIndex = 0;
  let charIndex = 0;
  let correct = 0;
  let misses = 0;
  let startedAt = 0;
  let duration = 60;
  let timer = 0;

  const renderPrompt = () => {
    const prompt = prompts[promptIndex % prompts.length];
    jaNode.textContent = prompt.ja;
    const done = prompt.romaji.slice(0, charIndex);
    const current = prompt.romaji.slice(charIndex, charIndex + 1);
    const rest = prompt.romaji.slice(charIndex + 1);
    romanNode.innerHTML = `<span class="done">${done}</span><span class="current">${current || " "}</span><span class="rest">${rest}</span>`;
  };

  const finish = () => {
    if (!running) return;
    running = false;
    clearInterval(timer);
    const elapsedMinutes = Math.max((performance.now() - startedAt) / 60000, 1 / 60);
    const kpm = correct / elapsedMinutes;
    const accuracy = correct + misses === 0 ? 100 : (correct / (correct + misses)) * 100;
    kpmNode.textContent = format(kpm, 0);
    wpmNode.textContent = format(kpm / 5, 1);
    accuracyNode.textContent = `${format(accuracy, 1)}%`;
    correctNode.textContent = correct.toLocaleString();
    result.hidden = false;
    messageNode.textContent = "測定完了。結果は同じ秒数で比べると成長を判断しやすくなります。";
    startButton.textContent = "もう一度測る";
  };

  const updateTime = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const remaining = Math.max(0, duration - elapsed);
    timeNode.textContent = remaining.toFixed(1);
    if (remaining <= 0) finish();
  };

  const start = () => {
    clearInterval(timer);
    running = true;
    promptIndex = 0;
    charIndex = 0;
    correct = 0;
    misses = 0;
    duration = Number(durationSelect.value);
    startedAt = performance.now();
    result.hidden = true;
    messageNode.textContent = "ローマ字をそのまま入力してください。IMEはOFFにします。";
    startButton.textContent = "測定中";
    renderPrompt();
    updateTime();
    timer = window.setInterval(updateTime, 50);
    stage.focus();
  };

  const reset = () => {
    clearInterval(timer);
    running = false;
    promptIndex = 0;
    charIndex = 0;
    correct = 0;
    misses = 0;
    timeNode.textContent = Number(durationSelect.value).toFixed(1);
    result.hidden = true;
    messageNode.textContent = "開始ボタンを押すと測定が始まります。";
    startButton.textContent = "測定を始める";
    renderPrompt();
  };

  stage.addEventListener("keydown", (event) => {
    if (!running || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const expected = prompts[promptIndex % prompts.length].romaji[charIndex];
    if (event.key.toLowerCase() === expected) {
      correct += 1;
      charIndex += 1;
      if (charIndex >= prompts[promptIndex % prompts.length].romaji.length) {
        promptIndex += 1;
        charIndex = 0;
      }
      renderPrompt();
    } else {
      misses += 1;
      messageNode.textContent = `ミス ${misses}回。慌てず現在の文字から続けてください。`;
    }
  });

  startButton.addEventListener("click", start);
  resetButton.addEventListener("click", reset);
  durationSelect.addEventListener("change", reset);
  reset();
}

function setupRomajiSearch() {
  const input = byId("romaji-search");
  if (!input) return;
  const rows = [...document.querySelectorAll(".romaji-table tbody tr")];
  const count = byId("romaji-count");
  const filter = () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matched = row.textContent.toLowerCase().includes(query);
      row.hidden = !matched;
      if (matched) visible += 1;
    }
    count.textContent = `${visible}件を表示`;
  };
  input.addEventListener("input", filter);
  filter();
}

setupConverter();
setupAccuracy();
setupSpeedTest();
setupRomajiSearch();
