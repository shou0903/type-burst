/**
 * 管理者統計ダッシュボード(D-093)のクライアントロジック。
 * トークンは sessionStorage に保存する(タブを閉じれば消える)。
 * 共有端末での残留リスクを抑えるため、localStorageには保存しない。
 */
(function () {
  "use strict";

  const TOKEN_KEY = "typeburst.admin-token.v1";
  const DIFFICULTY_COLORS = { easy: "#5fe8b6", normal: "#6fc0ff", hard: "#ffdf70", god: "#ff8a70" };
  const DIFFICULTY_LABELS = { easy: "初級", normal: "中級", hard: "上級", god: "神級" };

  const byId = (id) => document.getElementById(id);
  const gate = byId("ad-gate");
  const gateInput = byId("ad-token-input");
  const gateButton = byId("ad-token-submit");
  const gateError = byId("ad-gate-error");
  const dashboard = byId("ad-dashboard");
  const refreshButton = byId("ad-refresh");
  const logoutButton = byId("ad-logout");
  const generatedAtNode = byId("ad-generated-at");

  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function setToken(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // sessionStorageが使えない環境では毎回入力し直す運用になる
    }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // 無視
    }
  }

  function showGate(message) {
    dashboard.classList.add("ad-hidden");
    gate.classList.remove("ad-hidden");
    gateError.textContent = message || "";
    gateInput.focus();
  }

  function showDashboard() {
    gate.classList.add("ad-hidden");
    dashboard.classList.remove("ad-hidden");
  }

  async function fetchStats(token) {
    const res = await fetch("/api/admin/stats", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) {
      throw new Error("HTTP_" + res.status);
    }
    return res.json();
  }

  async function load(token) {
    try {
      const data = await fetchStats(token);
      showDashboard();
      render(data);
    } catch (error) {
      if (error && error.message === "UNAUTHORIZED") {
        clearToken();
        showGate("トークンが正しくありません。");
        return;
      }
      showGate("統計の取得に失敗しました。しばらくしてから再度お試しください。");
    }
  }

  function format(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    return Number(value).toLocaleString("ja-JP", {
      maximumFractionDigits: digits === undefined ? 0 : digits,
      minimumFractionDigits: digits === undefined ? 0 : digits,
    });
  }

  function formatDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // ------------------------------------------------------------------
  // Canvas描画(棒グラフ・ヒストグラム共通)
  // ------------------------------------------------------------------

  function drawBarChart(canvas, bars, options) {
    const opts = options || {};
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height || 180);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!bars || bars.length === 0) {
      ctx.fillStyle = "#8a93ad";
      ctx.font = "13px sans-serif";
      ctx.fillText("データがありません", 8, height / 2);
      return;
    }

    const padding = { top: 10, right: 8, bottom: 24, left: 8 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...bars.map((b) => b.value));
    const gap = 4;
    const barWidth = Math.max(2, plotWidth / bars.length - gap);

    ctx.font = "10px sans-serif";
    bars.forEach((bar, i) => {
      const x = padding.left + i * (barWidth + gap);
      const barHeight = (bar.value / maxValue) * plotHeight;
      const y = padding.top + plotHeight - barHeight;
      ctx.fillStyle = bar.color || opts.color || "#6fc0ff";
      ctx.fillRect(x, y, barWidth, barHeight);

      if (bar.label) {
        ctx.fillStyle = "#8a93ad";
        ctx.textAlign = "center";
        ctx.fillText(bar.label, x + barWidth / 2, height - 8);
      }
    });
    ctx.textAlign = "left";
  }

  function histogramToBars(hist, color) {
    if (!hist || hist.length === 0) return [];
    return hist.map((bucket) => ({
      value: bucket.count,
      color,
      label: Math.round(bucket.rangeStart).toString(),
    }));
  }

  // ------------------------------------------------------------------
  // テーブル
  // ------------------------------------------------------------------

  function renderTable(container, rows, columns, emptyText) {
    container.innerHTML = "";
    if (!rows || rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ad-empty";
      empty.textContent = emptyText || "データがありません";
      container.appendChild(empty);
      return;
    }
    const table = document.createElement("table");
    table.className = "ad-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      for (const col of columns) {
        const td = document.createElement("td");
        td.textContent = col.render ? col.render(row, index) : row[col.key];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ------------------------------------------------------------------
  // 描画本体
  // ------------------------------------------------------------------

  let latestData = null;
  let activeDifficulty = "normal";

  function render(data) {
    latestData = data;
    generatedAtNode.textContent = "生成: " + formatDate(data.generatedAt);

    // KPI
    byId("ad-kpi-shares").textContent = format(data.shares.totalCreated);
    byId("ad-kpi-daily-participants").textContent = format(data.daily.todayStats.participants);
    byId("ad-kpi-daily-kpm").textContent = data.daily.todayStats.kpm ? format(data.daily.todayStats.kpm.avg, 0) : "-";
    byId("ad-kpi-daily-accuracy").textContent = data.daily.todayStats.accuracy
      ? format(data.daily.todayStats.accuracy.avg, 1) + "%"
      : "-";

    // デイリー: 7日間トレンド
    const trendBars = data.daily.recentDays
      .slice()
      .reverse()
      .map((d) => ({ value: d.participants, color: "#6fc0ff", label: d.date.slice(5) }));
    drawBarChart(byId("ad-chart-daily-trend"), trendBars);

    // デイリー: 本日のKPM・正確率分布
    drawBarChart(byId("ad-chart-daily-kpm"), histogramToBars(data.daily.todayStats.kpmHistogram, "#6fc0ff"));
    drawBarChart(byId("ad-chart-daily-accuracy"), histogramToBars(data.daily.todayStats.accuracyHistogram, "#5fe8b6"));

    renderTable(
      byId("ad-table-daily-top"),
      data.daily.todayStats.top,
      [
        { label: "順位", render: (_row, i) => String(i + 1) },
        { label: "ニックネーム", key: "nickname" },
        { label: "スコア", render: (row) => format(row.score) },
        { label: "KPM", render: (row) => format(row.kpm) },
        { label: "正確率", render: (row) => format(row.accuracy, 1) + "%" },
      ],
      "本日の記録はまだありません",
    );

    renderSurvivalTab(activeDifficulty);
  }

  function renderSurvivalTab(difficulty) {
    activeDifficulty = difficulty;
    const data = latestData;
    if (!data) return;
    const stat = data.survival[difficulty];
    const color = DIFFICULTY_COLORS[difficulty];

    document.querySelectorAll(".ad-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.difficulty === difficulty);
    });

    byId("ad-kpi-survival-total").textContent = format(stat.total);
    byId("ad-kpi-survival-label").textContent = DIFFICULTY_LABELS[difficulty] + "の総送信数";

    drawBarChart(byId("ad-chart-survival-score"), histogramToBars(stat.scoreHistogram, color));

    renderTable(
      byId("ad-table-survival-top"),
      stat.top,
      [
        { label: "順位", render: (_row, i) => String(i + 1) },
        { label: "ニックネーム", key: "nickname" },
        { label: "スコア", render: (row) => format(row.score) },
        { label: "最大連鎖", key: "maxChain" },
        { label: "LEVEL", key: "level" },
        { label: "送信日時", render: (row) => formatDate(row.submittedAt) },
      ],
      "まだ記録がありません",
    );

    const chainSummary = stat.maxChain;
    const levelSummary = stat.level;
    byId("ad-survival-chain-summary").textContent = chainSummary
      ? "最大連鎖: 平均 " + format(chainSummary.avg, 1) + " / 中央値 " + format(chainSummary.median, 1) + " / 最大 " + format(chainSummary.max)
      : "最大連鎖: データなし";
    byId("ad-survival-level-summary").textContent = levelSummary
      ? "到達LEVEL: 平均 " + format(levelSummary.avg, 1) + " / 中央値 " + format(levelSummary.median, 1) + " / 最大 " + format(levelSummary.max)
      : "到達LEVEL: データなし";
  }

  // ------------------------------------------------------------------
  // イベント配線
  // ------------------------------------------------------------------

  gateButton.addEventListener("click", () => {
    const token = gateInput.value.trim();
    if (!token) return;
    setToken(token);
    load(token);
  });
  gateInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") gateButton.click();
  });

  refreshButton.addEventListener("click", () => {
    const token = getToken();
    if (token) load(token);
  });

  logoutButton.addEventListener("click", () => {
    clearToken();
    gateInput.value = "";
    showGate("");
  });

  document.querySelectorAll(".ad-tab").forEach((tab) => {
    tab.addEventListener("click", () => renderSurvivalTab(tab.dataset.difficulty));
  });

  window.addEventListener("resize", () => {
    if (latestData) render(latestData);
  });

  const existingToken = getToken();
  if (existingToken) {
    load(existingToken);
  } else {
    showGate("");
  }
})();
