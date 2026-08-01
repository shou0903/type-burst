/**
 * 管理者統計ダッシュボード(D-094, D-095で拡張)のクライアントロジック。
 * トークンは sessionStorage に保存する(タブを閉じれば消える)。
 * 共有端末での残留リスクを抑えるため、localStorageには保存しない。
 */
(function () {
  "use strict";

  const TOKEN_KEY = "typeburst.admin-token.v1";
  const DIFFICULTY_COLORS = { easy: "#5fe8b6", normal: "#6fc0ff", hard: "#ffdf70", god: "#ff8a70" };
  const DIFFICULTY_GLYPHS = { easy: "◆", normal: "●", hard: "★", god: "▲" };
  const DIFFICULTY_LABELS = { easy: "初級", normal: "中級", hard: "上級", god: "神級" };
  const DIFFICULTY_ORDER = ["easy", "normal", "hard", "god"];
  const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  const byId = (id) => document.getElementById(id);
  const gate = byId("pd-gate");
  const gateInput = byId("pd-token-input");
  const gateButton = byId("pd-token-submit");
  const gateError = byId("pd-gate-error");
  const dashboard = byId("pd-dashboard");
  const refreshButton = byId("pd-refresh");
  const logoutButton = byId("pd-logout");
  const exportButton = byId("pd-export");
  const generatedAtNode = byId("pd-generated-at");

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
    dashboard.classList.add("pd-hidden");
    gate.classList.remove("pd-hidden");
    gateError.textContent = message || "";
    gateInput.focus();
  }

  function showDashboard() {
    gate.classList.add("pd-hidden");
    dashboard.classList.remove("pd-hidden");
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
  // Canvas描画: 棒グラフ(ヒストグラム・トレンド・活動パターン共通)
  // ------------------------------------------------------------------

  /**
   * 棒グラフを描画する。tooltipEl を渡すと、マウスホバーで最も近い棒の値を表示する。
   * レイアウト計算(padding・barWidth)はツールチップ側の当たり判定と共有するため、
   * この関数の中に閉じ込めている。
   */
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
      detachTooltip(canvas);
      return;
    }

    const padding = { top: 10, right: 8, bottom: opts.showLabels === false ? 8 : 24, left: 8 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...bars.map((b) => b.value));
    const gap = opts.gap === undefined ? 4 : opts.gap;
    const barWidth = Math.max(1, plotWidth / bars.length - gap);

    ctx.font = "10px sans-serif";
    bars.forEach((bar, i) => {
      const x = padding.left + i * (barWidth + gap);
      const barHeight = (bar.value / maxValue) * plotHeight;
      const y = padding.top + plotHeight - barHeight;
      ctx.fillStyle = bar.color || opts.color || "#6fc0ff";
      ctx.fillRect(x, y, barWidth, barHeight);

      if (bar.label && opts.showLabels !== false) {
        ctx.fillStyle = "#8a93ad";
        ctx.textAlign = "center";
        ctx.fillText(bar.label, x + barWidth / 2, height - 8);
      }
    });
    ctx.textAlign = "left";

    if (opts.tooltipEl) {
      attachBarTooltip(canvas, opts.tooltipEl, bars, padding, barWidth, gap, opts.tooltipFormat);
    } else {
      detachTooltip(canvas);
    }
  }

  const tooltipHandlers = new WeakMap();

  function detachTooltip(canvas) {
    const existing = tooltipHandlers.get(canvas);
    if (existing) {
      canvas.removeEventListener("mousemove", existing.move);
      canvas.removeEventListener("mouseleave", existing.leave);
      tooltipHandlers.delete(canvas);
    }
  }

  function attachBarTooltip(canvas, tooltipEl, bars, padding, barWidth, gap, formatFn) {
    detachTooltip(canvas);
    const move = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const index = Math.floor((x - padding.left) / (barWidth + gap));
      const bar = bars[index];
      if (!bar) {
        tooltipEl.classList.remove("is-visible");
        return;
      }
      tooltipEl.textContent = formatFn ? formatFn(bar) : bar.label + ": " + bar.value;
      tooltipEl.style.left = x + "px";
      tooltipEl.style.top = event.clientY - rect.top + "px";
      tooltipEl.classList.add("is-visible");
    };
    const leave = () => tooltipEl.classList.remove("is-visible");
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseleave", leave);
    tooltipHandlers.set(canvas, { move, leave });
  }

  function histogramToBars(hist, color) {
    if (!hist || hist.length === 0) return [];
    return hist.map((bucket) => ({
      value: bucket.count,
      color,
      label: Math.round(bucket.rangeStart).toString(),
      rangeStart: bucket.rangeStart,
      rangeEnd: bucket.rangeEnd,
    }));
  }

  // ------------------------------------------------------------------
  // Canvas描画: 折れ線(14日間の平均推移)
  // ------------------------------------------------------------------

  function drawLineChart(canvas, points, color) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height || 180);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const valid = points.filter((p) => p.value !== null && p.value !== undefined);
    if (valid.length === 0) {
      ctx.fillStyle = "#8a93ad";
      ctx.font = "13px sans-serif";
      ctx.fillText("データがありません", 8, height / 2);
      return;
    }

    const padding = { top: 12, right: 10, bottom: 20, left: 10 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = valid.map((p) => p.value);
    const maxValue = Math.max(...values);
    const minValue = Math.min(0, Math.min(...values));
    const span = Math.max(1, maxValue - minValue);
    const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

    const xAt = (i) => padding.left + i * stepX;
    const yAt = (v) => padding.top + plotHeight - ((v - minValue) / span) * plotHeight;

    // 塗りつぶし(グラデーション)
    ctx.beginPath();
    let started = false;
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) return;
      const x = xAt(i);
      const y = yAt(p.value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, hexWithAlpha(color, 0.28));
    gradient.addColorStop(1, hexWithAlpha(color, 0));
    const lastValidIndex = [...points].reverse().findIndex((p) => p.value !== null && p.value !== undefined);
    const firstValidIndex = points.findIndex((p) => p.value !== null && p.value !== undefined);
    if (firstValidIndex >= 0 && lastValidIndex >= 0) {
      ctx.lineTo(xAt(points.length - 1 - lastValidIndex), height - padding.bottom);
      ctx.lineTo(xAt(firstValidIndex), height - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // 線
    ctx.beginPath();
    started = false;
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) return;
      const x = xAt(i);
      const y = yAt(p.value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 点
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) return;
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(p.value), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  function hexWithAlpha(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  // ------------------------------------------------------------------
  // テーブル
  // ------------------------------------------------------------------

  function renderTable(container, rows, columns, emptyText) {
    container.innerHTML = "";
    if (!rows || rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "pd-empty";
      empty.textContent = emptyText || "データがありません";
      container.appendChild(empty);
      return;
    }
    const table = document.createElement("table");
    table.className = "pd-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const rankClass = (i) => (i === 0 ? "pd-rank-1" : i === 1 ? "pd-rank-2" : i === 2 ? "pd-rank-3" : "");

    const tbody = document.createElement("tbody");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      columns.forEach((col, colIndex) => {
        const td = document.createElement("td");
        td.textContent = col.render ? col.render(row, index) : row[col.key];
        if (colIndex === 0) {
          const cls = rankClass(index);
          if (cls) td.className = cls;
        }
        tr.appendChild(td);
      });
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

    renderTopKpi(data);
    renderDifficultyOverview(data);
    renderDailySection(data);
    renderSurvivalTab(activeDifficulty);
    renderActivitySection(data);
  }

  function renderTopKpi(data) {
    byId("pd-kpi-shares").textContent = format(data.shares.totalCreated);

    const totalAll = DIFFICULTY_ORDER.reduce((sum, d) => sum + (data.survival[d].total || 0), 0);
    byId("pd-kpi-survival-total-all").textContent = format(totalAll);
    byId("pd-kpi-nickname-count").textContent =
      "ユニークニックネーム " + format(data.survivalActivity.uniqueNicknameCount) + "（サンプル内）";

    byId("pd-kpi-daily-participants").textContent = format(data.daily.todayStats.participants);
    byId("pd-kpi-daily-kpm").textContent = data.daily.todayStats.kpm ? format(data.daily.todayStats.kpm.avg, 0) : "-";
    byId("pd-kpi-daily-accuracy").textContent = data.daily.todayStats.accuracy
      ? format(data.daily.todayStats.accuracy.avg, 1) + "%"
      : "-";
  }

  function renderDifficultyOverview(data) {
    const grid = byId("pd-difficulty-grid");
    grid.innerHTML = "";
    for (const difficulty of DIFFICULTY_ORDER) {
      const stat = data.survival[difficulty];
      const color = DIFFICULTY_COLORS[difficulty];

      const card = document.createElement("div");
      card.className = "pd-difficulty-card" + (difficulty === activeDifficulty ? " is-active" : "");
      card.style.setProperty("--pd-diff-color", color);
      card.dataset.difficulty = difficulty;

      const head = document.createElement("div");
      head.className = "pd-difficulty-head";
      head.textContent = DIFFICULTY_GLYPHS[difficulty] + " " + DIFFICULTY_LABELS[difficulty];
      card.appendChild(head);

      const total = document.createElement("div");
      total.className = "pd-difficulty-total";
      total.textContent = format(stat.total);
      card.appendChild(total);

      const chartBox = document.createElement("div");
      chartBox.className = "pd-difficulty-mini-chart";
      const canvas = document.createElement("canvas");
      chartBox.appendChild(canvas);
      card.appendChild(chartBox);

      const stats = document.createElement("div");
      stats.className = "pd-difficulty-stats";
      const medianScore = stat.score ? format(stat.score.median) : "-";
      const maxChain = stat.maxChain ? format(stat.maxChain.max) : "-";
      stats.innerHTML =
        "<span>中央値 <strong>" + medianScore + "</strong></span>" +
        "<span>最大連鎖 <strong>" + maxChain + "</strong></span>";
      card.appendChild(stats);

      card.addEventListener("click", () => {
        activeDifficulty = difficulty;
        renderDifficultyOverview(latestData);
        renderSurvivalTab(difficulty);
      });

      grid.appendChild(card);
      // DOMに挿入された後でないと getBoundingClientRect が正しく取れない
      drawBarChart(canvas, histogramToBars(stat.scoreHistogram, color), { showLabels: false, gap: 2 });
    }
  }

  function renderDailySection(data) {
    const daily = data.daily;

    // 直近30日間の参加者数
    const trendBars = daily.recentDays
      .slice()
      .reverse()
      .map((d) => ({ value: d.participants, color: "#6fc0ff", label: d.date.slice(5), date: d.date }));
    drawBarChart(byId("pd-chart-daily-trend"), trendBars, {
      tooltipEl: byId("pd-tooltip-daily-trend"),
      tooltipFormat: (bar) => bar.date + "： " + bar.value + "人",
    });

    // 直近14日間の平均推移(折れ線)
    const trend = daily.recentTrend.slice().reverse();
    drawLineChart(
      byId("pd-chart-trend-score"),
      trend.map((t) => ({ value: t.avgScore, label: t.date })),
      "#ff8a70",
    );
    drawLineChart(
      byId("pd-chart-trend-kpm"),
      trend.map((t) => ({ value: t.avgKpm, label: t.date })),
      "#6fc0ff",
    );
    drawLineChart(
      byId("pd-chart-trend-accuracy"),
      trend.map((t) => ({ value: t.avgAccuracy, label: t.date })),
      "#5fe8b6",
    );

    // 本日の分布
    drawBarChart(byId("pd-chart-daily-score"), histogramToBars(daily.todayStats.scoreHistogram, "#ff8a70"));
    drawBarChart(byId("pd-chart-daily-kpm"), histogramToBars(daily.todayStats.kpmHistogram, "#6fc0ff"));
    drawBarChart(byId("pd-chart-daily-accuracy"), histogramToBars(daily.todayStats.accuracyHistogram, "#5fe8b6"));

    renderTable(
      byId("pd-table-daily-top"),
      daily.todayStats.top,
      [
        { label: "順位", render: (_row, i) => String(i + 1) },
        { label: "ニックネーム", key: "nickname" },
        { label: "スコア", render: (row) => format(row.score) },
        { label: "KPM", render: (row) => format(row.kpm) },
        { label: "正確率", render: (row) => format(row.accuracy, 1) + "%" },
      ],
      "本日の記録はまだありません",
    );
  }

  function renderSurvivalTab(difficulty) {
    activeDifficulty = difficulty;
    const data = latestData;
    if (!data) return;
    const stat = data.survival[difficulty];
    const color = DIFFICULTY_COLORS[difficulty];

    document.querySelectorAll(".pd-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.difficulty === difficulty);
    });
    document.querySelectorAll(".pd-difficulty-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.difficulty === difficulty);
    });
    byId("pd-survival-detail-glyph").textContent = DIFFICULTY_GLYPHS[difficulty];

    drawBarChart(byId("pd-chart-survival-score"), histogramToBars(stat.scoreHistogram, color), {
      tooltipEl: byId("pd-tooltip-survival-score"),
      tooltipFormat: (bar) => format(bar.rangeStart) + "〜" + format(bar.rangeEnd) + "： " + bar.value + "件",
    });
    drawBarChart(byId("pd-chart-survival-chain"), histogramToBars(stat.maxChainHistogram, color));
    drawBarChart(byId("pd-chart-survival-level"), histogramToBars(stat.levelHistogram, color));

    renderTable(
      byId("pd-table-survival-top"),
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
    byId("pd-survival-chain-summary").textContent = chainSummary
      ? "最大連鎖: 平均 " + format(chainSummary.avg, 1) + " / 中央値 " + format(chainSummary.median, 1) + " / 最大 " + format(chainSummary.max)
      : "最大連鎖: データなし";
    byId("pd-survival-level-summary").textContent = levelSummary
      ? "到達LEVEL: 平均 " + format(levelSummary.avg, 1) + " / 中央値 " + format(levelSummary.median, 1) + " / 最大 " + format(levelSummary.max)
      : "到達LEVEL: データなし";
  }

  function renderActivitySection(data) {
    const activity = data.survivalActivity;

    const hourBars = activity.byHour.map((h) => ({ value: h.count, color: "#6fc0ff", label: String(h.hour) }));
    drawBarChart(byId("pd-chart-activity-hour"), hourBars, { gap: 2 });

    const weekdayBars = activity.byWeekday.map((w) => ({
      value: w.count,
      color: "#ffdf70",
      label: WEEKDAY_LABELS[w.weekday],
    }));
    drawBarChart(byId("pd-chart-activity-weekday"), weekdayBars, { gap: 6 });

    const list = byId("pd-nickname-list");
    list.innerHTML = "";
    if (activity.topNicknames.length === 0) {
      const li = document.createElement("li");
      li.textContent = "データがありません";
      list.appendChild(li);
    }
    activity.topNicknames.forEach((entry) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = entry.nickname;
      const count = document.createElement("span");
      count.className = "pd-nickname-count";
      count.textContent = entry.count + "回";
      li.appendChild(name);
      li.appendChild(count);
      list.appendChild(li);
    });
  }

  function exportJson() {
    if (!latestData) return;
    const blob = new Blob([JSON.stringify(latestData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "type-burst-stats-" + latestData.generatedAt.slice(0, 10) + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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

  exportButton.addEventListener("click", exportJson);

  document.querySelectorAll(".pd-tab").forEach((tab) => {
    tab.addEventListener("click", () => renderSurvivalTab(tab.dataset.difficulty));
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (latestData) render(latestData);
    }, 150);
  });

  const existingToken = getToken();
  if (existingToken) {
    load(existingToken);
  } else {
    showGate("");
  }
})();
