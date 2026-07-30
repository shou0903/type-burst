import { dailySavings, estimateTasks, formatMinutes } from "./workloadEstimate";

/** タイピング速度から実務の所要時間を計算する(D-092)。計算は workloadEstimate.ts に分離する。 */

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`作業時間換算: #${id} が見つかりません`);
  return element;
};

const kpmInput = byId("wl-kpm") as unknown as HTMLInputElement;
const charsInput = byId("wl-chars") as unknown as HTMLInputElement;
const targetInput = byId("wl-target") as unknown as HTMLInputElement;
const runButton = byId("wl-run") as HTMLButtonElement;
const result = byId("wl-result");
const tableBody = byId("wl-tbody");
const savingsNode = byId("wl-savings");
const errorNode = byId("wl-error");

function readPositive(input: HTMLInputElement, max: number): number | null {
  const value = Number(input.value.trim());
  if (!Number.isFinite(value) || value <= 0 || value > max) return null;
  return value;
}

function renderTasks(kpm: number): void {
  tableBody.textContent = "";
  for (const row of estimateTasks(kpm)) {
    const tr = document.createElement("tr");

    const name = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = row.task.name;
    name.appendChild(strong);
    const note = document.createElement("small");
    note.textContent = ` ${row.task.note}`;
    name.appendChild(note);
    tr.appendChild(name);

    const chars = document.createElement("td");
    chars.textContent = `${row.task.chars.toLocaleString()}字`;
    tr.appendChild(chars);

    const typing = document.createElement("td");
    typing.textContent = formatMinutes(row.typingMinutes);
    tr.appendChild(typing);

    const realistic = document.createElement("td");
    realistic.textContent = formatMinutes(row.realisticMinutes);
    tr.appendChild(realistic);

    tableBody.appendChild(tr);
  }
}

function renderSavings(kpm: number, target: number, chars: number): void {
  savingsNode.textContent = "";
  const saving = dailySavings(kpm, target, chars);
  if (!saving) return;

  if (saving.savedMinutesPerDay <= 0) {
    const p = document.createElement("p");
    p.textContent = "目標速度が現在の速度以下です。目標値を今より大きくしてください。";
    savingsNode.appendChild(p);
    return;
  }

  const lead = document.createElement("p");
  lead.textContent = `1日に ${chars.toLocaleString()} 字を入力する場合、${Math.round(kpm)} KPM では約${formatMinutes(
    saving.currentMinutes,
  )}、${Math.round(target)} KPM では約${formatMinutes(saving.targetMinutes)}かかります。`;
  savingsNode.appendChild(lead);

  const highlight = document.createElement("p");
  highlight.className = "diagnosis-level";
  highlight.textContent = `1日あたり約${formatMinutes(saving.savedMinutesPerDay)}の短縮`;
  savingsNode.appendChild(highlight);

  const yearly = document.createElement("p");
  yearly.textContent = `年間240営業日として、約${Math.round(saving.savedHoursPerYear)}時間に相当します。`;
  savingsNode.appendChild(yearly);
}

function run(): void {
  const kpm = readPositive(kpmInput, 1500);
  if (kpm === null) {
    errorNode.textContent = "1〜1500の範囲で、現在の速度（KPM）を入力してください。";
    errorNode.hidden = false;
    result.hidden = true;
    return;
  }
  errorNode.hidden = true;

  renderTasks(kpm);
  const chars = readPositive(charsInput, 200000);
  const target = readPositive(targetInput, 1500);
  if (chars !== null && target !== null) {
    renderSavings(kpm, target, chars);
  } else {
    savingsNode.textContent = "";
  }
  result.hidden = false;
}

runButton.addEventListener("click", run);
for (const input of [kpmInput, charsInput, targetInput]) {
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") run();
  });
}
