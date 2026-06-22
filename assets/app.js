let appData = null;
let selectedSymbol = null;
let visibleStocks = [];

const CUSTOM_STOCKS_KEY = "mifa.customStocks";
const HIDDEN_STOCKS_KEY = "mifa.hiddenStocks";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function readStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSymbol(market, code) {
  return `${String(market || "").toUpperCase()}.${String(code || "").replace(/\D/g, "").slice(0, 6)}`;
}

function number(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${number(n)}%`;
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function setClass(id, className) {
  const node = document.getElementById(id);
  if (node) node.className = className;
}

function badge(id, text, cls) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.className = `badge ${cls}`;
}

function average(rows, key = "close") {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (!values.length) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rollingMa(history, window) {
  return history.map((row, index) => {
    if (index + 1 < window) return null;
    return average(history.slice(index + 1 - window, index + 1), "close");
  });
}

function levelRank(level) {
  return level === "bad" ? 3 : level === "warn" ? 2 : level === "good" ? 1 : 0;
}

function createLocalStock({ market, code, name, theme, watchReason }) {
  const symbol = normalizeSymbol(market, code);
  return {
    symbol,
    market,
    code,
    name,
    theme: theme || "网页添加",
    watchReason: watchReason || "网页自选股",
    localOnly: true,
    quote: {},
    history: [],
    analysis: {
      status: "待数据更新",
      posture: "等待数据",
      action: "加入观察",
      level: "neutral",
      reason: "已加入当前浏览器自选股，等待行情更新后生成走势图和操作信号。",
      alerts: [{
        level: "warn",
        title: "待行情更新",
        body: "此标的已保存在当前浏览器；运行本地更新脚本或同步到 data/watchlist.json 后，可补齐富途 OpenD 行情、走势图和风险预警。"
      }]
    }
  };
}

function getCustomStocks() {
  return readStore(CUSTOM_STOCKS_KEY, []);
}

function getHiddenSymbols() {
  return new Set(readStore(HIDDEN_STOCKS_KEY, []));
}

function applyLocalWatchlist() {
  const baseStocks = (appData?.stocks || []).map((stock) => ({ ...stock, localOnly: false }));
  const hidden = getHiddenSymbols();
  const customStocks = getCustomStocks();
  const baseSymbols = new Set(baseStocks.map((stock) => stock.symbol));
  visibleStocks = baseStocks
    .filter((stock) => !hidden.has(stock.symbol))
    .concat(customStocks.filter((stock) => !hidden.has(stock.symbol) && !baseSymbols.has(stock.symbol)));
  return visibleStocks;
}

function renderAll() {
  const stocks = applyLocalWatchlist();
  renderPortfolio(stocks);
  if (!stocks.length) {
    renderWatchlist(stocks);
    selectedSymbol = null;
    setText("detailTitle", "图表走势");
    setText("detailSubtitle", "请先添加自选股。");
    document.getElementById("priceChart").innerHTML = "<p class=\"readout\">暂无自选股。</p>";
    return;
  }
  if (!stocks.some((stock) => stock.symbol === selectedSymbol)) selectedSymbol = stocks[0].symbol;
  renderWatchlist(stocks);
  selectStock(selectedSymbol);
}

function renderPortfolio(stocks) {
  const highRisk = stocks.filter((stock) => (stock.analysis?.alerts || []).some((alert) => alert.level === "bad")).length;
  const setups = stocks.filter((stock) => ["关键点突破", "临近突破"].includes(stock.analysis?.status)).length;
  const latest = stocks.map((stock) => stock.quote?.tradeTime).filter(Boolean).sort().at(-1) || "--";
  setText("stockCount", String(stocks.length));
  setText("highRiskCount", String(highRisk));
  setText("setupCount", String(setups));
  setText("latestTradeDate", latest.slice(0, 10));
  if (highRisk > 0) {
    setText("portfolioStatus", `${highRisk} 个高风险预警`);
    setText("portfolioNote", "优先检查趋势破位、深回撤和放量下跌。");
  } else if (setups > 0) {
    setText("portfolioStatus", `${setups} 个关键点机会`);
    setText("portfolioNote", "关注突破是否有量能和基本面确认。");
  } else {
    setText("portfolioStatus", "整体观察");
    setText("portfolioNote", "暂无高优先级风险，继续等待关键点。");
  }
}

function renderWatchlist(stocks) {
  const grid = document.getElementById("watchlistGrid");
  if (!stocks.length) {
    grid.innerHTML = "<p class=\"readout\">当前没有自选股。可以在上方添加，或点击“恢复默认名单”。</p>";
    return;
  }
  grid.innerHTML = stocks.map((stock) => {
    const q = stock.quote || {};
    const a = stock.analysis || {};
    const alerts = a.alerts || [];
    const topLevel = alerts.reduce((max, alert) => levelRank(alert.level) > levelRank(max) ? alert.level : max, "good");
    const selected = stock.symbol === selectedSymbol ? " selected" : "";
    return `
      <article class="stock-card${selected}">
        <button class="stock-card-main" type="button" data-symbol="${escapeHtml(stock.symbol)}">
          <span class="stock-top">
            <b>${escapeHtml(stock.name)}</b>
            <i class="badge ${a.level || topLevel || "neutral"}">${escapeHtml(a.status || "待计算")}</i>
          </span>
          <span class="stock-code">${escapeHtml(stock.symbol)} · ${escapeHtml(stock.theme || "")}${stock.localOnly ? " · 本地自选" : ""}</span>
          <span class="stock-price">${number(q.price)} 元 <em class="${Number(q.changePct) >= 0 ? "up" : "down"}">${formatPct(q.changePct)}</em></span>
          <span class="stock-meta">PE ${number(q.peTtm)}x · PB ${number(q.pb)}x · 预警 ${alerts.length}</span>
        </button>
        <button class="stock-delete" type="button" data-remove-symbol="${escapeHtml(stock.symbol)}">删除</button>
      </article>
    `;
  }).join("");
  grid.querySelectorAll(".stock-card-main").forEach((card) => {
    card.addEventListener("click", () => selectStock(card.dataset.symbol));
  });
  grid.querySelectorAll(".stock-delete").forEach((button) => {
    button.addEventListener("click", () => removeStock(button.dataset.removeSymbol));
  });
}

function linePath(values, xForIndex, yForValue) {
  let started = false;
  return values.map((value, index) => {
    if (!Number.isFinite(value)) return "";
    const prefix = started ? "L" : "M";
    started = true;
    return `${prefix}${xForIndex(index).toFixed(1)},${yForValue(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

function renderChart(stock) {
  const host = document.getElementById("priceChart");
  const history = stock.history || [];
  if (history.length < 2) {
    host.innerHTML = "<p class=\"readout\">暂无足够历史行情。</p>";
    setText("chartRange", "--");
    return;
  }
  const rows = history.slice(-120);
  const closes = rows.map((row) => Number(row.close));
  const ma10 = rollingMa(rows, 10);
  const ma20 = rollingMa(rows, 20);
  const allValues = closes.concat(ma10, ma20).filter(Number.isFinite);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const pad = Math.max((max - min) * 0.08, 1);
  const yMin = min - pad;
  const yMax = max + pad;
  const width = 920;
  const height = 320;
  const left = 54;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const xForIndex = (index) => left + (plotW * index) / Math.max(1, rows.length - 1);
  const yForValue = (value) => top + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
  const ticks = [yMin, yMin + (yMax - yMin) / 2, yMax];
  const last = rows.at(-1);
  const first = rows[0];
  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(stock.name)}价格走势图">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#fff" />
      ${ticks.map((tick) => `
        <line x1="${left}" y1="${yForValue(tick)}" x2="${width - right}" y2="${yForValue(tick)}" stroke="#e5ebf1" />
        <text x="12" y="${yForValue(tick) + 4}" fill="#5c6d7e" font-size="12">${number(tick)}</text>
      `).join("")}
      <path d="${linePath(closes, xForIndex, yForValue)}" fill="none" stroke="#155e9f" stroke-width="2.6" />
      <path d="${linePath(ma10, xForIndex, yForValue)}" fill="none" stroke="#247a52" stroke-width="1.8" />
      <path d="${linePath(ma20, xForIndex, yForValue)}" fill="none" stroke="#9a6b13" stroke-width="1.8" />
      <circle cx="${xForIndex(rows.length - 1)}" cy="${yForValue(Number(last.close))}" r="4" fill="#155e9f" />
      <text x="${left}" y="${height - 12}" fill="#5c6d7e" font-size="12">${first.date}</text>
      <text x="${width - right - 78}" y="${height - 12}" fill="#5c6d7e" font-size="12">${last.date}</text>
    </svg>
  `;
  setText("chartRange", `${first.date} 至 ${last.date} · ${rows.length} 个交易日`);
}

function renderDetail(stock) {
  const q = stock.quote || {};
  const a = stock.analysis || {};
  setText("detailTitle", `${stock.name} 图表走势`);
  setText("detailSubtitle", `${stock.symbol} · ${stock.theme || "自选股"} · ${stock.watchReason || ""}`);
  badge("trendBadge", a.status || "待计算", a.level || "neutral");
  badge("setupBadge", a.status || "待计算", a.level || "neutral");
  badge("livermoreBadge", a.action || "规则信号", a.level || "neutral");
  setText("livermoreAction", a.action || "等待计算");
  setText("livermoreReason", a.reason || "等待行情和历史走势数据。");
  setText("ret5", formatPct(a.ret5));
  setText("ret20", formatPct(a.ret20));
  setClass("ret5", Number(a.ret5) >= 0 ? "up" : "down");
  setClass("ret20", Number(a.ret20) >= 0 ? "up" : "down");
  setText("maState", `MA10 ${number(a.ma10)} / MA20 ${number(a.ma20)}`);
  setText("pivotRange", `${number(a.low20)} - ${number(a.prior20High)}`);
  setText("trendRead", [
    `${stock.name} 最新价 ${number(q.price)} 元，今日涨跌 ${formatPct(q.changePct)}。`,
    `5 日涨跌 ${formatPct(a.ret5)}，20 日涨跌 ${formatPct(a.ret20)}。`,
    `近 20 日关键上沿约 ${number(a.prior20High)} 元，下沿约 ${number(a.low20)} 元；成交量约为 20 日均量的 ${number(a.volRatio)} 倍。`,
    `当前判断：${a.reason || "暂无判断"}`
  ].join(" "));
  const rules = [
    `关键点：放量站上近 20 日高点 ${number(a.prior20High)} 元，才视作第一买点。`,
    `试探仓：首次突破只用小仓位，避免未验证时一次性重仓。`,
    `加码：站稳关键点并继续上行至约 ${number(a.addLine)} 元以上，再考虑顺势加仓。`,
    `止损：跌破 MA20 或回到关键区间下方，参考防守线约 ${number(a.stopLine)} 元。`,
    `纪律：不向下摊平，不用基本面故事对抗已经走坏的趋势。`
  ];
  document.getElementById("operationRules").innerHTML = rules.map((rule) => `<li>${rule}</li>`).join("");
  const alerts = (a.alerts || []).slice().sort((x, y) => levelRank(y.level) - levelRank(x.level));
  const topRisk = alerts[0]?.level || "neutral";
  badge("riskBadge", alerts.length ? `${alerts.length} 条预警` : "暂无预警", topRisk);
  document.getElementById("riskList").innerHTML = alerts.map((alert) => `
    <li class="${alert.level}">
      <b>${escapeHtml(alert.title)}</b>
      <small>${escapeHtml(alert.body)}</small>
    </li>
  `).join("");
  renderChart(stock);
  renderWatchlist(visibleStocks);
}

function selectStock(symbol) {
  selectedSymbol = symbol;
  const stock = visibleStocks.find((item) => item.symbol === symbol) || visibleStocks[0];
  if (!stock) return;
  selectedSymbol = stock.symbol;
  renderDetail(stock);
}

function removeStock(symbol) {
  const customStocks = getCustomStocks();
  const nextCustomStocks = customStocks.filter((stock) => stock.symbol !== symbol);
  writeStore(CUSTOM_STOCKS_KEY, nextCustomStocks);

  const hidden = getHiddenSymbols();
  hidden.add(symbol);
  writeStore(HIDDEN_STOCKS_KEY, [...hidden]);
  setText("watchlistFormNote", `${symbol} 已从当前浏览器自选股中删除。`);
  renderAll();
}

function initWatchlistForm() {
  const form = document.getElementById("watchlistForm");
  const restoreButton = document.getElementById("restoreWatchlistButton");
  if (!form || !restoreButton) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const market = document.getElementById("watchMarket").value;
    const code = document.getElementById("watchCode").value.replace(/\D/g, "");
    const name = document.getElementById("watchName").value.trim();
    const theme = document.getElementById("watchTheme").value.trim();
    const watchReason = document.getElementById("watchReason").value.trim();
    if (!/^\d{6}$/.test(code) || !name) {
      setText("watchlistFormNote", "请填写 6 位股票代码和股票名称。");
      return;
    }

    const symbol = normalizeSymbol(market, code);
    const customStocks = getCustomStocks();
    const hidden = getHiddenSymbols();
    const alreadyVisible = applyLocalWatchlist().some((stock) => stock.symbol === symbol);
    if (alreadyVisible) {
      setText("watchlistFormNote", `${symbol} 已在当前自选股中。`);
      return;
    }

    hidden.delete(symbol);
    writeStore(HIDDEN_STOCKS_KEY, [...hidden]);
    writeStore(CUSTOM_STOCKS_KEY, customStocks.concat(createLocalStock({ market, code, name, theme, watchReason })));
    selectedSymbol = symbol;
    form.reset();
    setText("watchlistFormNote", `${symbol} ${name} 已加入当前浏览器自选股，等待数据更新后补齐走势图。`);
    renderAll();
  });

  restoreButton.addEventListener("click", () => {
    localStorage.removeItem(CUSTOM_STOCKS_KEY);
    localStorage.removeItem(HIDDEN_STOCKS_KEY);
    selectedSymbol = appData?.stocks?.[0]?.symbol || null;
    setText("watchlistFormNote", "已恢复数据文件中的默认自选股名单。");
    renderAll();
  });
}

async function loadDashboard() {
  setText("dataStamp", "正在读取 data/watchlist-data.json...");
  const response = await fetch(`data/watchlist-data.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`watchlist-data fetch failed: ${response.status}`);
  appData = await response.json();
  setText("projectName", appData.projectName || "米法的自选股");
  setText("dataStamp", `更新时间：${appData.updatedAt || "--"} · 来源：${appData.source || "--"}`);
  selectedSymbol = selectedSymbol || appData.stocks?.[0]?.symbol;
  renderAll();
}

document.getElementById("refreshButton").addEventListener("click", () => {
  loadDashboard().catch((error) => setText("dataStamp", `读取失败：${error.message}`));
});

initWatchlistForm();
loadDashboard().catch((error) => setText("dataStamp", `读取失败：${error.message}`));
