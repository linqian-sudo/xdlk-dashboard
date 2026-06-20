const FINANCIALS = {
  fy2025RevenueYi: 5.237407,
  fy2025NetProfitYi: 3.034108,
  ttmRevenueYi: 4.869529,
  ttmNetProfitYi: 2.615964,
  requiredPe: 40
};

const signals = [
  {
    item: "2026Q2/Q3 收入恢复",
    status: "Q1 收入同比 -41.86%，等待后续季报",
    add: "收入环比明显恢复，扣非利润转正",
    stop: "连续两个季度低于 2025 年同期"
  },
  {
    item: "限售股解禁后供给压力",
    status: "2026-06-30 约 37.72% 总股本解禁",
    add: "解禁后无持续减持压力",
    stop: "核心股东或一致行动人披露大额减持"
  },
  {
    item: "单片三轴陀螺 / 六轴 IMU",
    status: "研发、可靠性和良率验证中",
    add: "定型量产并进入客户放量",
    stop: "量产节点持续延后或客户验证失败"
  },
  {
    item: "毛利率和费用吸收",
    status: "2025 毛利率高，Q1 费用率因收入下降显著抬升",
    add: "收入增长带动费用率回落",
    stop: "新品放量但毛利率明显下台阶"
  }
];

const risks = [
  ["客户集中", "Q1 已显示提货节奏对业绩影响很大，需要用后续订单恢复来验证。", "high"],
  ["高估值", "约百倍 TTM PE 的容错率较低，业绩兑现慢会先杀估值。", "high"],
  ["解禁和减持", "6 月底大额限售股上市流通，短期供给预期可能扰动股价。", "high"],
  ["研发到量产的不确定性", "高性能 MEMS 产品从样品、可靠性、良率到客户量产周期较长。", ""]
];

function number(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function setBar(id, pct) {
  const node = document.getElementById(id);
  if (node) node.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function badge(id, text, cls) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.className = `badge ${cls}`;
}

function renderStaticLists() {
  document.getElementById("signalRows").innerHTML = signals.map((row) => `
    <tr>
      <td><strong>${row.item}</strong></td>
      <td>${row.status}</td>
      <td>${row.add}</td>
      <td>${row.stop}</td>
    </tr>
  `).join("");

  document.getElementById("riskList").innerHTML = risks.map(([title, body, level]) => `
    <li class="${level}">
      <b>${title}</b>
      <small>${body}</small>
    </li>
  `).join("");
}

function renderQuote(payload) {
  const q = payload.quote;
  const price = Number(q.price);
  const change = Number(q.change);
  const changePct = Number(q.changePct);
  const marketCap = Number(q.marketCapYi);
  const amountYi = Number(q.amountYi);
  const high52 = Number(q.high52w);
  const low52 = Number(q.low52w);

  setText("quoteName", `${q.name} (${q.code})`);
  setText("quoteStamp", `行情时间：${q.tradeTime || payload.updatedAt || "--"} · 来源：${payload.source || "quote cache"}`);
  setText("lastPrice", `${number(price)} 元`);
  setText("priceChange", `${change >= 0 ? "+" : ""}${number(change)} / ${changePct >= 0 ? "+" : ""}${number(changePct)}%`);
  document.getElementById("priceChange").className = change >= 0 ? "up" : "down";
  setText("marketCap", `${number(marketCap)} 亿`);
  setText("peTtm", `${number(q.peTtm)}x`);
  setText("pb", `${number(q.pb)}x`);
  setText("amount", `${number(amountYi)} 亿`);
  setText("turnover", `换手率 ${number(q.turnover)}%`);
  setText("range52w", `${number(low52)} - ${number(high52)} 元`);

  const rangePct = Number.isFinite(high52 - low52) && high52 > low52
    ? ((price - low52) / (high52 - low52)) * 100
    : NaN;
  setText("rangePosition", Number.isFinite(rangePct) ? `处于 52 周区间约 ${number(rangePct, 0)}% 分位` : "--");

  const staticPe = marketCap / FINANCIALS.fy2025NetProfitYi;
  const psTtm = marketCap / FINANCIALS.ttmRevenueYi;
  const impliedProfit = marketCap / FINANCIALS.requiredPe;
  const impliedGrowth = impliedProfit / FINANCIALS.fy2025NetProfitYi - 1;

  setText("staticPe", `${number(staticPe)}x`);
  setText("psTtm", `${number(psTtm)}x`);
  setText("impliedProfit", `${number(impliedProfit)} 亿`);
  setBar("staticPeBar", staticPe);
  setBar("psTtmBar", psTtm * 2);
  setBar("impliedProfitBar", impliedGrowth * 100);

  if (staticPe >= 70 || Number(q.peTtm) >= 80) {
    badge("valuationBadge", "估值偏热", "bad");
    setText("valuationRead", `按最新市值约 ${number(marketCap)} 亿元测算，静态 PE 约 ${number(staticPe)}x。若用 40x PE 作为较保守成长股锚点，需要年净利润约 ${number(impliedProfit)} 亿元，比 2025 年高约 ${number(impliedGrowth * 100, 0)}%。`);
  } else if (staticPe >= 45) {
    badge("valuationBadge", "估值中高", "warn");
    setText("valuationRead", "估值仍要求未来利润继续兑现，适合等待业绩验证后分批提高仓位。");
  } else {
    badge("valuationBadge", "估值回落", "good");
    setText("valuationRead", "估值压力较前期有所缓和，但仍需确认 Q1 波动不是趋势性下滑。");
  }
}

async function loadQuote() {
  setText("quoteStamp", "正在读取 data/quote.json...");
  const response = await fetch(`data/quote.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`quote fetch failed: ${response.status}`);
  const payload = await response.json();
  renderQuote(payload);
}

document.getElementById("refreshButton").addEventListener("click", () => {
  loadQuote().catch((error) => {
    setText("quoteStamp", `读取失败：${error.message}`);
  });
});

renderStaticLists();
loadQuote().catch((error) => {
  setText("quoteStamp", `读取失败：${error.message}`);
});
