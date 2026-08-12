/* global echarts, lucide, __MARKET__, __ANALYSIS__ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const UP = "#e5484d";
const DOWN = "#30a46c";
const DIM = "#9aa3b2";
const ACCENT = "#d8a13e";

const DISCIPLINE_RULES = [
  "没有计划的交易不做，计划外不交易。",
  "单只股票仓位不超过总资金 20%。",
  "总仓位不超过 80%，单日新建仓不超过 40%。",
  "买入分批执行，第一笔不超过计划仓位的 50%。",
  "止损无条件执行：单笔亏损 8% 或跌破计划位，直接卖出。",
  "不加仓摊平亏损，亏损仓只在计划内减仓。",
  "不在大涨 7% 以上且 KDJ J 值大于 100 时追高。",
  "盘中只在 09:30 / 11:00 / 14:00 三档看盘。",
  "盈利 +15% 减半仓，回撤超过最高点 8% 移动止盈。",
  "收盘后完成复盘，不完成复盘不建新仓。",
];

const REPOS = [
  {
    name: "kedoupi/portfolio-monitor",
    stars: 19,
    desc: "股票监控工作台，美股 + A 股实时行情，多档位 Telegram 告警，持仓与交易记录管理，Docker 一键部署。",
    borrow: ["自选监控与告警", "持仓记录管理", "行情看板"],
    url: "https://github.com/kedoupi/portfolio-monitor",
  },
  {
    name: "duhanjun/jingni-trader",
    stars: 3,
    desc: "基于大语言模型的 A 股投研决策与交易执行全栈工作流，融合量化与主观投研，支持分析报告、回测、组合优化和模拟/实盘交易。",
    borrow: ["AI 分析报告生成", "策略回测与组合优化", "模拟交易执行流"],
    url: "https://github.com/duhanjun/jingni-trader",
  },
  {
    name: "MQ-Makubex/personal-trading-coach",
    stars: 0,
    desc: "中文股票交易教练本地工作台：脱敏交易事实、长期底账、每日教练手记、研究股票池与盘中纪律训练。",
    borrow: ["交易纪律打卡", "每日教练手记", "本地长期底账"],
    url: "https://github.com/MQ-Makubex/personal-trading-coach",
  },
];

const state = {
  market: window.__MARKET__,
  analysis: window.__ANALYSIS__,
  selected: null,
  klineRange: 260,
  klineChart: null,
  minuteChart: null,
  flowChart: null,
  discipline: load("ths_discipline", { date: "", done: [] }),
  violations: load("ths_violations", { date: "", count: 0 }),
  journal: load("ths_journal", []),
  positions: load("ths_positions", []),
  orders: load("ths_orders", []),
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return Number(v).toFixed(digits);
}

function signCls(v) {
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "flat";
}

function signed(v, digits = 2, suffix = "") {
  const n = Number(v || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
}

function findAnalysis(ths) {
  return state.analysis.items.find((a) => a.ths === ths) || null;
}

function findItem(ths) {
  return state.market.items.find((i) => i.ths === ths) || null;
}

function findQuoteByCode(code) {
  const norm = String(code).replace(/^(sh|sz)/, "").replace(/^0+/, "");
  for (const item of state.market.items) {
    const q = item.quote || {};
    if (q.code && String(q.code).replace(/^0+/, "") === norm) return q;
    if (item.ths && String(item.ths).replace(/^0+/, "") === norm) return q;
  }
  return null;
}

/* ---------- Stock list ---------- */

function renderStockList() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const list = $("#stockList");
  list.innerHTML = "";
  let count = 0;
  for (const item of state.market.items) {
    const name = item.name || "";
    const code = item.ths || "";
    if (q && !name.toLowerCase().includes(q) && !code.toLowerCase().includes(q)) continue;
    count += 1;
    const quote = item.quote || {};
    const pct = quote.pct ?? 0;
    const row = document.createElement("button");
    row.className = "stock-row" + (state.selected && state.selected.ths === item.ths ? " active" : "");
    row.dataset.ths = item.ths;
    row.innerHTML = `
      <span class="stock-code">${code}</span>
      <span class="stock-main">
        <span class="stock-name">${name}</span>
        <span class="stock-kind">${kindLabel(item.kind)}</span>
      </span>
      <span class="stock-price ${signCls(pct)}">
        <b>${fmt(quote.price)}</b>
        <span>${signed(pct)}%</span>
      </span>`;
    row.addEventListener("click", () => selectStock(item.ths));
    list.appendChild(row);
  }
  $("#stockCount").textContent = count > 0 ? `(${count})` : "";
}

function kindLabel(kind) {
  return { stock: "A股", etf: "ETF", index: "指数", block: "板块" }[kind] || "其他";
}

function selectStock(ths) {
  const item = findItem(ths);
  if (!item) return;
  state.selected = item;
  renderStockList();
  renderQuoteStrip(item);
  renderCharts(item);
  renderAi(item);
  renderLevels(item);
  $("#view-advice").classList.remove("active");
  $("#view-market").classList.add("active");
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "market"));
}

/* ---------- Quote strip ---------- */

function renderQuoteStrip(item) {
  const q = item.quote || {};
  const pct = q.pct ?? 0;
  const wrap = $("#quoteStrip");
  wrap.innerHTML = `
    <div class="quote-main">
      <h3>${item.name} <span class="muted">${item.ths} · ${kindLabel(item.kind)}</span></h3>
      <div class="quote-price">
        <b class="${signCls(pct)}">${fmt(q.price)}</b>
        <span class="${signCls(pct)}">${signed(q.change)}</span>
        <span class="${signCls(pct)}">${signed(pct)}%</span>
      </div>
    </div>
    ${stat("今开", q.open, pct)}
    ${stat("最高", q.high, pct)}
    ${stat("最低", q.low, pct)}
    ${stat("昨收", q.prev_close, pct)}
    ${stat("成交额", q.amount ? (q.amount / 10000).toFixed(2) + "亿" : "--", pct)}
    ${stat("换手", q.turnover ? q.turnover.toFixed(2) + "%" : "--", pct)}`;
}

function stat(label, value, pct) {
  return `<div class="stat"><span>${label}</span><b class="${signCls(pct)}">${value ?? "--"}</b></div>`;
}

/* ---------- Charts ---------- */

function computeMa(closes, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    out.push(i >= n - 1 ? +(sum / n).toFixed(3) : null);
  }
  return out;
}

function computeMacd(closes) {
  const ema = (arr, n) => {
    const out = [];
    let prev = null;
    const k = 2 / (n + 1);
    for (const v of arr) {
      prev = prev === null ? v : v * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  };
  const ef = ema(closes, 12);
  const es = ema(closes, 26);
  const dif = ef.map((v, i) => v - es[i]);
  const dea = ema(dif, 9);
  return { dif, dea, hist: dif.map((v, i) => (v - dea[i]) * 2) };
}

function buildKlineOption(item) {
  const range = state.klineRange;
  const kline = item.kline.slice(-range);
  if (!kline.length) return {};
  const dates = kline.map((r) => r.date);
  const candles = kline.map((r) => [r.open, r.close, r.low, r.high]);
  const closes = kline.map((r) => r.close);
  const vols = kline.map((r) => r.volume);
  const macd = computeMacd(closes);
  const ma5 = computeMa(closes, 5);
  const ma10 = computeMa(closes, 10);
  const ma20 = computeMa(closes, 20);
  const ma60 = computeMa(closes, 60);

  const axisCommon = {
    axisLine: { lineStyle: { color: "#2a2f38" } },
    axisLabel: { color: DIM, fontSize: 11 },
    splitLine: { lineStyle: { color: "#232833" } },
  };

  return {
    backgroundColor: "transparent",
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#2a2f38" } },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#20242c",
      borderColor: "#2a2f38",
      textStyle: { color: "#e8eaf0", fontSize: 12 },
    },
    grid: [
      { left: 52, right: 14, top: 14, height: "54%" },
      { left: 52, right: 14, top: "66%", height: "12%" },
      { left: 52, right: 14, top: "82%", height: "12%" },
    ],
    xAxis: [
      { type: "category", data: dates, ...axisCommon, axisLabel: { show: false } },
      { type: "category", data: dates, gridIndex: 1, ...axisCommon, axisLabel: { show: false } },
      { type: "category", data: dates, gridIndex: 2, ...axisCommon },
    ],
    yAxis: [
      { scale: true, ...axisCommon },
      { gridIndex: 1, ...axisCommon, splitLine: { show: false }, axisLabel: { show: false } },
      { gridIndex: 2, ...axisCommon, splitLine: { show: false } },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1, 2], start: range > 120 ? 55 : 0, end: 100 },
      { type: "slider", xAxisIndex: [0, 1, 2], bottom: 2, height: 16, borderColor: "#2a2f38", backgroundColor: "#16181d", fillerColor: "rgba(216,161,62,0.18)", handleStyle: { color: "#d8a13e" }, textStyle: { color: DIM, fontSize: 10 } },
    ],
    series: [
      {
        name: "K线", type: "candlestick", data: candles,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
      },
      { name: "MA5", type: "line", data: ma5, symbol: "none", lineStyle: { width: 1, color: "#e6a23c" } },
      { name: "MA10", type: "line", data: ma10, symbol: "none", lineStyle: { width: 1, color: "#4f9cf7" } },
      { name: "MA20", type: "line", data: ma20, symbol: "none", lineStyle: { width: 1, color: "#9d6ff5" } },
      { name: "MA60", type: "line", data: ma60, symbol: "none", lineStyle: { width: 1, color: "#f56c6c" } },
      {
        name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols.map((v, i) => ({
          value: v,
          itemStyle: { color: candles[i][1] >= candles[i][0] ? UP : DOWN, opacity: 0.75 },
        })),
      },
      {
        name: "MACD", type: "bar", xAxisIndex: 2, yAxisIndex: 2,
        data: macd.hist.map((v) => ({ value: +v.toFixed(3), itemStyle: { color: v >= 0 ? UP : DOWN, opacity: 0.8 } })),
      },
      { name: "DIF", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: macd.dif.map((v) => +v.toFixed(3)), symbol: "none", lineStyle: { width: 1, color: "#e6a23c" } },
      { name: "DEA", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: macd.dea.map((v) => +v.toFixed(3)), symbol: "none", lineStyle: { width: 1, color: "#4f9cf7" } },
    ],
  };
}

function buildMinuteOption(item) {
  const points = (item.minute && item.minute.points) || [];
  if (!points.length) return {};
  const prev = item.minute.prev_close || (item.quote && item.quote.prev_close) || points[0].price;
  const times = points.map((p) => p.time);
  const prices = points.map((p) => p.price);
  const avg = [];
  let amt = 0;
  let vol = 0;
  for (const p of points) {
    amt += p.amount;
    vol += p.volume;
    avg.push(vol ? +(amt / (vol * 100)).toFixed(3) : p.price);
  }
  const vols = points.map((p) => p.volume);
  const base = prev || points[0].price;
  const min = Math.min(...prices, ...avg);
  const max = Math.max(...prices, ...avg);
  const pad = Math.max((max - min) * 0.25, base * 0.002);
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#20242c",
      borderColor: "#2a2f38",
      textStyle: { color: "#e8eaf0", fontSize: 12 },
    },
    legend: { top: 0, textStyle: { color: DIM, fontSize: 11 }, data: ["价格", "均价"] },
    grid: [
      { left: 52, right: 14, top: 34, height: "62%" },
      { left: 52, right: 14, top: "72%", height: "20%" },
    ],
    xAxis: [
      { type: "category", data: times, boundaryGap: false, axisLine: { lineStyle: { color: "#2a2f38" } }, axisLabel: { color: DIM, fontSize: 10, interval: 59 } },
      { type: "category", data: times, gridIndex: 1, axisLine: { lineStyle: { color: "#2a2f38" } }, axisLabel: { show: false } },
    ],
    yAxis: [
      {
        scale: true, min: min - pad, max: max + pad,
        axisLabel: { color: DIM, fontSize: 11 },
        splitLine: { lineStyle: { color: "#232833" } },
      },
      { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
    ],
    series: [
      { name: "价格", type: "line", data: prices, symbol: "none", lineStyle: { width: 1.2, color: UP } },
      { name: "均价", type: "line", data: avg, symbol: "none", lineStyle: { width: 1, color: ACCENT } },
      {
        name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols.map((v, i) => ({
          value: v,
          itemStyle: { color: prices[i] >= (prev || prices[0]) ? UP : DOWN, opacity: 0.7 },
        })),
      },
    ],
  };
}

function buildFlowOption(item) {
  const intraday = item.fflow_intraday || [];
  const daily = item.fflow || [];
  const timeLabels = intraday.map((p) => p.time.slice(11, 16));
  let cum = 0;
  const cumMain = intraday.map((p) => (cum += p.main));
  const last = daily.length ? daily[daily.length - 1] : null;
  const mainToday = last ? last.main : (cumMain.length ? cumMain[cumMain.length - 1] : 0);
  const series = [];
  if (intraday.length) {
    series.push({
      name: "主力累计净流入", type: "line", data: cumMain.map((v) => +(v / 1e8).toFixed(3)),
      symbol: "none", lineStyle: { width: 1.6, color: mainToday >= 0 ? UP : DOWN },
      areaStyle: { color: mainToday >= 0 ? "rgba(229,72,77,0.12)" : "rgba(48,164,108,0.12)" },
    });
  }
  const categories = [];
  const values = [];
  const colors = [];
  if (last) {
    const groups = [
      ["主力", last.main], ["超大单", last.super], ["大单", last.large],
      ["中单", last.medium], ["小单", last.small],
    ];
    for (const [name, v] of groups) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      categories.push(name);
      values.push(+(n / 1e8).toFixed(3));
      colors.push(n >= 0 ? UP : DOWN);
    }
  }
  if (categories.length) {
    series.push({
      name: "当日分项净流入", type: "bar", data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
      barMaxWidth: 34,
    });
  }
  if (!series.length) return {};
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#20242c", borderColor: "#2a2f38",
      textStyle: { color: "#e8eaf0", fontSize: 12 },
      valueFormatter: (v) => `${Number(v).toFixed(2)} 亿`,
    },
    legend: { top: 0, textStyle: { color: DIM, fontSize: 11 } },
    grid: intraday.length && categories.length
      ? [{ left: 52, right: 14, top: 34, height: "42%" }, { left: 52, right: 14, top: "56%", height: "36%" }]
      : { left: 52, right: 14, top: 34, bottom: 24 },
    xAxis: intraday.length && categories.length
      ? [
          { type: "category", data: timeLabels, boundaryGap: false, axisLabel: { color: DIM, fontSize: 10, interval: 59 }, axisLine: { lineStyle: { color: "#2a2f38" } } },
          { type: "category", data: categories, gridIndex: 1, axisLabel: { color: DIM, fontSize: 11 }, axisLine: { lineStyle: { color: "#2a2f38" } } },
        ]
      : { type: "category", data: categories, axisLabel: { color: DIM, fontSize: 11 }, axisLine: { lineStyle: { color: "#2a2f38" } } },
    yAxis: intraday.length && categories.length
      ? [
          { scale: true, axisLabel: { color: DIM, fontSize: 11 }, splitLine: { lineStyle: { color: "#232833" } } },
          { gridIndex: 1, axisLabel: { color: DIM, fontSize: 11 }, splitLine: { lineStyle: { color: "#232833" } } },
        ]
      : { axisLabel: { color: DIM, fontSize: 11 }, splitLine: { lineStyle: { color: "#232833" } } },
    series,
  };
}

function renderCharts(item) {
  if (!state.klineChart) {
    state.klineChart = echarts.init($("#klineChart"));
    state.minuteChart = echarts.init($("#minuteChart"));
    state.flowChart = echarts.init($("#flowChart"));
  }
  state.klineChart.setOption(buildKlineOption(item), true);
  state.minuteChart.setOption(buildMinuteOption(item), true);
  state.flowChart.setOption(buildFlowOption(item), true);
  const q = item.quote || {};
  $("#minuteDate").textContent = q.datetime ? `${q.datetime.slice(0, 8)} 分时` : "分时";
}

/* ---------- AI panel & levels ---------- */

function renderAi(item) {
  const a = findAnalysis(item.ths);
  const panel = $("#aiPanel");
  const pill = $("#scorePill");
  if (!a || a.skip) {
    panel.innerHTML = `<p>该标的无公开行情，暂无法生成 AI 解读。${item.name === "同花顺板块886033" ? "这是同花顺板块代码，建议在 App 中确认板块名称。" : ""}</p>`;
    pill.textContent = "--";
    return;
  }
  pill.textContent = `评分 ${a.score}`;
  const tags = [
    `趋势 ${a.trend}`,
    `建议 ${a.action}`,
    `风险 ${a.risk}`,
    a.indicators.rsi !== null ? `RSI ${fmt(a.indicators.rsi, 0)}` : "",
    a.indicators.kdj_j !== null ? `KDJ J ${fmt(a.indicators.kdj_j, 0)}` : "",
    a.indicators.macd_hist > 0 ? "MACD 红柱" : "MACD 绿柱",
    a.main_flow > 0 ? `主力 +${(a.main_flow / 1e8).toFixed(2)}亿` : `主力 ${(a.main_flow / 1e8).toFixed(2)}亿`,
  ].filter(Boolean);
  panel.innerHTML = `
    <p>${a.narrative || "暂无解读"}</p>
    <div class="gauge"><i style="width:${Math.max(2, Math.min(100, a.score))}%"></i></div>
    <div class="ai-tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>`;
  $("#aiPanel").innerHTML = panel.innerHTML;
}

function renderLevels(item) {
  const a = findAnalysis(item.ths);
  const box = $("#levelsPanel");
  if (!a || a.skip) {
    box.innerHTML = `<div class="level-item"><span>说明</span><b>暂无数据</b></div>`;
    return;
  }
  const ind = a.indicators;
  const rows = [
    ["支撑位", a.support, DOWN],
    ["压力位", a.resistance, UP],
    ["MA5 / MA10", `${fmt(ind.ma5)} / ${fmt(ind.ma10)}`, DIM],
    ["MA20 / MA60", `${fmt(ind.ma20)} / ${fmt(ind.ma60)}`, DIM],
    ["BOLL 下轨", fmt(ind.boll_low), DOWN],
    ["BOLL 上轨", fmt(ind.boll_up), UP],
    ["主力净流入", `${(a.main_flow / 1e8).toFixed(2)} 亿`, a.main_flow >= 0 ? UP : DOWN],
    ["资金占比", `${fmt(a.main_ratio, 1)}%`, a.main_ratio >= 0 ? UP : DOWN],
  ];
  box.innerHTML = rows.map(([label, value, color]) => `
    <div class="level-item"><span>${label}</span><b style="color:${color}">${value}</b></div>`).join("");
}

/* ---------- Advice view ---------- */

function renderAdvice() {
  const day = (state.market.fetched_at || "").slice(0, 10) || "今日";
  const hour = new Date(state.market.fetched_at.replace(" ", "T")).getHours();
  const session = hour < 12 ? "午间" : "收盘";
  $("#portfolioSummary").innerHTML = `
    <h3>组合概览 · ${day} ${session}</h3>
    <p>${state.analysis.summary || ""}</p>`;

  const body = $("#adviceTable tbody");
  body.innerHTML = "";
  for (const item of state.market.items) {
    const a = findAnalysis(item.ths);
    const q = item.quote || {};
    const pct = q.pct ?? 0;
    const tr = document.createElement("tr");
    tr.className = "clickable";
    if (a && !a.skip) {
      tr.innerHTML = `
        <td>${item.ths}</td>
        <td><b>${item.name}</b></td>
        <td class="${signCls(pct)}">${fmt(q.price)}</td>
        <td class="${signCls(pct)}">${signed(pct)}%</td>
        <td><b>${a.score}</b></td>
        <td>${a.trend}</td>
        <td class="${a.action === "持有" || a.action === "持有/低吸" ? "up" : a.action.includes("减") ? "down" : ""}">${a.action}</td>
        <td>${a.risk}</td>
        <td>${fmt(a.support)}</td>
        <td>${fmt(a.resistance)}</td>
        <td class="${a.main_flow >= 0 ? "up" : "down"}">${(a.main_flow / 1e8).toFixed(2)}亿</td>`;
    } else {
      tr.innerHTML = `
        <td>${item.ths}</td><td><b>${item.name}</b></td><td>--</td><td>--</td><td>--</td>
        <td>--</td><td>待确认</td><td>--</td><td>--</td><td>--</td><td>--</td>`;
    }
    tr.addEventListener("click", () => selectStock(item.ths));
    body.appendChild(tr);
  }

  $("#planBox").innerHTML = `
    <ol>
      <li>大盘：上证午间 3946.51（+0.32%），站上 MA20（约 3860）；午后关注能否守住 3940，放量突破 3968 则维持偏多，缩量回落则不加仓。</li>
      <li>新主线观察：锂电（赣锋、亿纬、宁德）、稀土（金力永磁、中国稀土、中科三环）、机器人（三花、绿的谐波、汇川）与红利 ETF 构成新的自选结构，先看资金承接。</li>
      <li>强势票：亿纬锂能、三花智控、绿的谐波、中国稀土评分较高，持有不追高，回踩 5 日线分批低吸。</li>
      <li>半导体反抽：中微公司 +5.13%、天孚通信 +10.97%、东山精密 +3.16%，短线超涨注意兑现，不追盘中直线。</li>
      <li>偏弱票：宁德时代、汇川技术、洛阳钼业、北方稀土主力或走势偏弱，只做回踩确认，不左侧接刀。</li>
      <li>总仓位 ≤ 80%，单票 ≤ 20%；午后 14:30 后不追单，尾盘 30 分钟只减不加。</li>
    </ol>`;
}

/* ---------- Discipline view ---------- */

function resetDisciplineIfNeeded() {
  const t = today();
  if (state.discipline.date !== t) {
    state.discipline = { date: t, done: [] };
    save("ths_discipline", state.discipline);
  }
  if (state.violations.date !== t) {
    state.violations = { date: t, count: 0 };
    save("ths_violations", state.violations);
  }
}

function renderDiscipline() {
  resetDisciplineIfNeeded();
  const list = $("#disciplineList");
  list.innerHTML = "";
  DISCIPLINE_RULES.forEach((rule, i) => {
    const item = document.createElement("div");
    item.className = "check-item";
    const checked = state.discipline.done.includes(i);
    item.innerHTML = `<input type="checkbox" id="disc-${i}" ${checked ? "checked" : ""}><label for="disc-${i}">${rule}</label>`;
    item.querySelector("input").addEventListener("change", (e) => {
      const set = new Set(state.discipline.done);
      if (e.target.checked) set.add(i);
      else set.delete(i);
      state.discipline.done = Array.from(set);
      save("ths_discipline", state.discipline);
      renderDiscipline();
    });
    list.appendChild(item);
  });
  $("#discScore").textContent = `${state.discipline.done.length} / ${DISCIPLINE_RULES.length}`;
  $("#violationCount").textContent = `今日违规 ${state.violations.count} 次`;

  const jl = $("#journalList");
  jl.innerHTML = state.journal.length
    ? state.journal.slice().reverse().map((j, idx) => `
        <div class="journal-entry">
          <b>${j.date}</b> <span class="muted">纪律 ${j.score}/100 · ${j.emotion || "-"}</span><br>
          操作：${j.action || "-"}<br>
          计划：${j.plan || "-"} · 错误：${j.mistake || "-"}<br>
          明日：${j.next || "-"}
        </div>`).join("")
    : `<div class="journal-entry">还没有复盘记录，收盘后记得完成第一条。</div>`;
}

function bindDiscipline() {
  $("#resetDiscipline").addEventListener("click", () => {
    state.discipline = { date: today(), done: [] };
    save("ths_discipline", state.discipline);
    renderDiscipline();
    toast("今日纪律已重置");
  });
  $("#addViolation").addEventListener("click", () => {
    state.violations.count += 1;
    save("ths_violations", state.violations);
    renderDiscipline();
    toast(`已记录违规，今日第 ${state.violations.count} 次`);
  });
  $("#journalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.journal.push({
      date: $("#jDate").value || today(),
      score: $("#jScore").value || "0",
      action: $("#jAction").value,
      plan: $("#jPlan").value,
      mistake: $("#jMistake").value,
      emotion: $("#jEmotion").value,
      next: $("#jNext").value,
    });
    save("ths_journal", state.journal);
    e.target.reset();
    renderDiscipline();
    toast("复盘已保存");
  });
}

/* ---------- Sim view ---------- */

function renderSim() {
  $("#simAccountInfo").innerHTML = `
    账户：<b>模拟炒股*gutz</b>（同花顺模拟盘） · 用户ID 843281676 · 资金账号 118977367<br>
    环境：trade.10jqka.com.cn:8002 · 持仓与成交记录由服务器托管，本地仅缓存连接日志；
    可用下方导入功能维护本地台账。`;
  renderPositions();
  renderOrders();
}

function renderPositions() {
  const body = $("#posTable tbody");
  body.innerHTML = "";
  let totalCost = 0;
  let totalValue = 0;
  for (const p of state.positions) {
    const q = findQuoteByCode(p.code);
    const price = q ? q.price : Number(p.price || 0);
    const cost = Number(p.cost || 0);
    const qty = Number(p.qty || 0);
    const pnl = (price - cost) * qty;
    totalCost += cost * qty;
    totalValue += price * qty;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.code}</td><td><b>${p.name}</b></td><td>${qty}</td>
      <td>${fmt(cost)}</td><td class="${signCls(price - cost)}">${fmt(price)}</td>
      <td class="${signCls(pnl)}">${fmt(pnl)} (${cost ? signed((price - cost) / cost * 100) + "%" : "--"})</td>
      <td><button class="del-btn" data-pos="${p.code}" title="删除"><i data-lucide="trash-2"></i></button></td>`;
    body.appendChild(tr);
  }
  $("#posSummary").textContent = state.positions.length
    ? `成本 ${(totalCost / 10000).toFixed(2)}万 · 市值 ${(totalValue / 10000).toFixed(2)}万 · 浮动 ${(totalValue - totalCost) >= 0 ? "+" : ""}${((totalValue - totalCost) / 10000).toFixed(2)}万`
    : "暂无持仓，可导入";
  lucide.createIcons();
  $$("#posTable [data-pos]").forEach((btn) => btn.addEventListener("click", () => {
    state.positions = state.positions.filter((p) => p.code !== btn.dataset.pos);
    save("ths_positions", state.positions);
    renderPositions();
    toast("持仓已删除");
  }));
}

function renderOrders() {
  const body = $("#orderTable tbody");
  body.innerHTML = "";
  if (!state.orders.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">暂无操作记录，添加一条买入/卖出流水。</td></tr>`;
  } else {
    state.orders.slice().reverse().forEach((o, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${o.date}</td><td class="${o.type === "买入" ? "up" : "down"}"><b>${o.type}</b></td>
        <td>${o.code}</td><td>${o.name}</td><td>${fmt(o.price)}</td><td>${o.qty}</td>
        <td>${o.note || ""}</td>
        <td><button class="del-btn" data-order="${idx}" title="删除"><i data-lucide="trash-2"></i></button></td>`;
      body.appendChild(tr);
    });
  }
  lucide.createIcons();
  $$("#orderTable [data-order]").forEach((btn) => btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.order);
    state.orders.splice(state.orders.length - 1 - idx, 1);
    save("ths_orders", state.orders);
    renderOrders();
    toast("记录已删除");
  }));
}

function bindSim() {
  $("#orderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.orders.push({
      date: $("#oDate").value || today(),
      type: $("#oType").value,
      code: $("#oCode").value.trim(),
      name: $("#oName").value.trim(),
      price: Number($("#oPrice").value),
      qty: Number($("#oQty").value),
      note: $("#oNote").value.trim(),
    });
    save("ths_orders", state.orders);
    e.target.reset();
    renderOrders();
    toast("操作记录已添加");
  });

  $("#parseImport").addEventListener("click", () => {
    const text = $("#importText").value.trim();
    if (!text) return toast("请先粘贴持仓数据");
    const rows = text.split(/\n+/).map((l) => l.split(/[\t,;，;]+|\s+/).filter(Boolean));
    const parsed = [];
    for (const r of rows) {
      if (r.length < 4) continue;
      parsed.push({
        code: r[0],
        name: r[1],
        qty: Number(r[2]),
        cost: Number(r[3]),
        price: Number(r[4] || 0),
      });
    }
    if (!parsed.length) return toast("没有解析到有效行，格式：代码 名称 数量 成本 现价");
    state.positions = parsed;
    save("ths_positions", state.positions);
    renderPositions();
    $("#importMsg").textContent = `已导入 ${parsed.length} 条持仓`;
  });

  $("#exportSim").addEventListener("click", () => {
    downloadFile("sim_records.json", JSON.stringify({ positions: state.positions, orders: state.orders }, null, 2));
    toast("模拟盘记录已导出");
  });
}

/* ---------- GitHub view ---------- */

function renderGithub() {
  $("#repoGrid").innerHTML = REPOS.map((r) => `
    <div class="repo-card">
      <h3><a href="${r.url}" target="_blank" rel="noreferrer">${r.name}</a> <span class="muted">★${r.stars}</span></h3>
      <p>${r.desc}</p>
      <div class="repo-tags">${r.borrow.map((t) => `<span>${t}</span>`).join("")}</div>
    </div>`).join("");
}

/* ---------- Refresh ---------- */

async function refreshData() {
  if (location.protocol === "file:") {
    toast("请先运行 python3 server.py 再使用实时刷新");
    return;
  }
  $("#refreshBtn").classList.add("loading");
  try {
    const codes = state.market.items.filter((i) => i.tencent).map((i) => i.tencent);
    const qRes = await fetch(`/api/quote?codes=${codes.join(",")}`);
    const qData = await qRes.json();
    if (qData.ok) {
      for (const item of state.market.items) {
        if (item.tencent && qData.data[item.tencent]) item.quote = qData.data[item.tencent];
      }
    }
    const sel = state.selected || state.market.items[0];
    if (sel && sel.tencent) {
      const [kRes, mRes, fRes] = await Promise.all([
        fetch(`/api/kline?code=${sel.tencent}`),
        fetch(`/api/minute?code=${sel.tencent}`),
        sel.em ? fetch(`/api/fflow?code=${sel.em}`) : Promise.resolve({ json: () => ({ ok: true, data: { intraday: [], daily: [] } }) }),
      ]);
      const kData = await kRes.json();
      const mData = await mRes.json();
      const fData = await fRes.json();
      if (kData.ok) sel.kline = kData.data;
      if (mData.ok) {
        sel.minute = { ...mData.data, prev_close: sel.quote.prev_close };
      }
      if (fData.ok) {
        if (fData.data.daily && fData.data.daily.length) sel.fflow = fData.data.daily;
        if (fData.data.intraday && fData.data.intraday.length) sel.fflow_intraday = fData.data.intraday;
      }
      selectStock(sel.ths);
    }
    renderStockList();
    renderAdvice();
    toast("行情已刷新");
  } catch (e) {
    toast("刷新失败：" + (e.message || e));
  } finally {
    $("#refreshBtn").classList.remove("loading");
  }
}

/* ---------- Export ---------- */

function downloadFile(name, content) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    fetchedAt: state.market.fetched_at,
    watchlist: state.market.items.map((i) => ({ ths: i.ths, name: i.name, kind: i.kind, quote: i.quote })),
    analysisSummary: { portfolio: state.analysis.portfolio, summary: state.analysis.summary, items: state.analysis.items },
    sim: { positions: state.positions, orders: state.orders },
    discipline: state.discipline,
    journal: state.journal,
  };
  $("#exportContent").textContent = JSON.stringify(payload, null, 2);
  $("#exportModal").classList.remove("hidden");
}

/* ---------- Toast ---------- */

function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- Init ---------- */

function init() {
  state.market = window.__MARKET__ || { items: [] };
  state.analysis = window.__ANALYSIS__ || { items: [] };
  if (window.__SIM__) {
    if (!localStorage.getItem("ths_positions")) state.positions = window.__SIM__.positions || [];
    if (!localStorage.getItem("ths_orders")) state.orders = window.__SIM__.orders || [];
  }
  if (!state.market.items.length) {
    document.body.innerHTML = '<div style="padding:40px;color:#9aa3b2">数据文件缺失：请确认 data/data.js 存在。</div>';
    return;
  }
  state.selected = state.market.items.find((i) => i.ths === "688981") || state.market.items[0];

  $("#dataStamp").textContent = `数据更新：${state.market.fetched_at || "--"}`;
  renderStockList();
  renderQuoteStrip(state.selected);
  renderCharts(state.selected);
  renderAi(state.selected);
  renderLevels(state.selected);
  renderAdvice();
  renderDiscipline();
  renderSim();
  renderGithub();
  bindEvents();
  lucide.createIcons();

  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const timeNum = hh * 60 + mm;
  const trading = (timeNum >= 570 && timeNum <= 690) || (timeNum >= 780 && timeNum <= 900);
  const el = $("#marketStatus");
  el.textContent = trading ? "交易中" : "已收盘";
  el.classList.toggle("live", trading);
}

function bindEvents() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab.dataset.tab}`));
    requestAnimationFrame(() => {
      if (state.klineChart) state.klineChart.resize();
      if (state.minuteChart) state.minuteChart.resize();
      if (state.flowChart) state.flowChart.resize();
    });
  }));

  $("#searchInput").addEventListener("input", renderStockList);

  $$("#klineRange .seg-btn").forEach((btn) => btn.addEventListener("click", () => {
    $$("#klineRange .seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.klineRange = Number(btn.dataset.range);
    if (state.selected) renderCharts(state.selected);
  }));

  $("#refreshBtn").addEventListener("click", refreshData);
  $("#exportBtn").addEventListener("click", renderExport);
  $("#closeExport").addEventListener("click", () => $("#exportModal").classList.add("hidden"));
  $("#exportModal").addEventListener("click", (e) => {
    if (e.target === $("#exportModal")) $("#exportModal").classList.add("hidden");
  });
  $("#downloadExport").addEventListener("click", () => {
    downloadFile("trading_workstation_export.json", $("#exportContent").textContent);
    toast("已下载导出文件");
  });

  bindDiscipline();
  bindSim();

  let resizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (state.klineChart) state.klineChart.resize();
      if (state.minuteChart) state.minuteChart.resize();
      if (state.flowChart) state.flowChart.resize();
    }, 120);
  });
}

document.addEventListener("DOMContentLoaded", init);
