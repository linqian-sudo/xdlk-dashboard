import { readFile, writeFile, mkdir } from "node:fs/promises";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dataDir = new URL("../data/", import.meta.url);
const watchlistPath = new URL("../data/watchlist.json", import.meta.url);
const outputPath = new URL("../data/watchlist-data.json", import.meta.url);
const legacyQuotePath = new URL("../data/quote.json", import.meta.url);
const legacyHistoryPath = new URL("../data/quote-history.json", import.meta.url);

function txSymbol(stock) {
  return `${stock.market === "SH" ? "sh" : "sz"}${stock.code}`;
}

function fetchTextOnce(target, referer = "https://quote.eastmoney.com/") {
  return new Promise((resolve, reject) => {
    const req = https.get(target, {
      family: 4,
      headers: {
        "User-Agent": "Mozilla/5.0 mifa-watchlist",
        "Accept": "application/json,text/plain,*/*",
        "Connection": "close",
        "Referer": referer
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    }).on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("request timeout")));
  });
}

async function fetchText(target, referer, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetchTextOnce(target, referer);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
  try {
    const { stdout } = await execFileAsync(curlBin, [
      "-L",
      "--max-time",
      "60",
      "-A",
      "Mozilla/5.0 mifa-watchlist",
      "-e",
      referer,
      target
    ], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (curlError) {
    throw lastError || curlError;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTradeTime(raw) {
  if (!raw || raw.length < 14) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const hh = raw.slice(8, 10);
  const mm = raw.slice(10, 12);
  const ss = raw.slice(12, 14);
  return {
    label: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
    iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`
  };
}

function parseTencentQuote(raw, stock) {
  const match = raw.match(/="([^"]+)"/);
  if (!match) throw new Error(`Unexpected Tencent quote payload for ${stock.symbol}`);
  const f = match[1].split("~");
  const tradeTime = parseTradeTime(f[30]);
  return {
    name: stock.name,
    code: stock.code,
    symbol: stock.symbol,
    market: stock.market,
    tradeTime: tradeTime?.label || null,
    updatedAt: tradeTime?.iso || new Date().toISOString(),
    price: toNumber(f[3]),
    prevClose: toNumber(f[4]),
    open: toNumber(f[5]),
    high: toNumber(f[33]),
    low: toNumber(f[34]),
    change: toNumber(f[31]),
    changePct: toNumber(f[32]),
    volumeShares: toNumber(f[36] || f[6]),
    amountYi: toNumber(f[37]) ? toNumber(f[37]) / 10000 : null,
    turnover: toNumber(f[38]),
    peTtm: toNumber(f[39]),
    pb: toNumber(f[46]),
    marketCapYi: toNumber(f[45]),
    floatMarketCapYi: toNumber(f[44]),
    high52w: toNumber(f[67]),
    low52w: toNumber(f[68]),
    totalShares: toNumber(f[73]),
    floatShares: toNumber(f[72])
  };
}

function parseEastmoneyKlines(raw) {
  const payload = JSON.parse(raw);
  const klines = payload?.data?.klines;
  if (!Array.isArray(klines)) throw new Error("Unexpected Eastmoney kline payload");
  return klines.map((line) => {
    const [date, open, close, high, low, volume, amount, amplitude, changePct, change, turnover] = line.split(",");
    return {
      date,
      open: toNumber(open),
      close: toNumber(close),
      high: toNumber(high),
      low: toNumber(low),
      volume: toNumber(volume),
      amountYi: toNumber(amount) ? toNumber(amount) / 100000000 : null,
      amplitude: toNumber(amplitude),
      changePct: toNumber(changePct),
      change: toNumber(change),
      turnover: toNumber(turnover)
    };
  }).filter((row) => row.date && row.close !== null).slice(-260);
}

function parseTencentKlines(raw, stock) {
  const payload = JSON.parse(raw);
  const key = txSymbol(stock);
  const rows = payload?.data?.[key]?.qfqday || payload?.data?.[key]?.day;
  if (!Array.isArray(rows)) throw new Error(`Unexpected Tencent kline payload for ${stock.symbol}`);
  return rows.map((row) => ({
    date: row[0],
    open: toNumber(row[1]),
    close: toNumber(row[2]),
    high: toNumber(row[3]),
    low: toNumber(row[4]),
    volume: toNumber(row[5]),
    amountYi: null,
    amplitude: null,
    changePct: null,
    change: null,
    turnover: null
  })).filter((row) => row.date && row.close !== null).slice(-260);
}

function mergeQuoteIntoHistory(history, quote) {
  const key = quote.tradeTime?.slice(0, 10) || quote.updatedAt?.slice(0, 10);
  if (!key || !quote.price) return history;
  const next = history.filter((row) => row.date !== key);
  next.push({
    date: key,
    open: quote.open,
    close: quote.price,
    high: quote.high,
    low: quote.low,
    volume: quote.volumeShares,
    amountYi: quote.amountYi,
    changePct: quote.changePct,
    change: quote.change,
    turnover: quote.turnover,
    marketCapYi: quote.marketCapYi,
    peTtm: quote.peTtm
  });
  return next.sort((a, b) => a.date.localeCompare(b.date)).slice(-260);
}

function average(rows, key = "close") {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctChange(now, prev) {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return (now / prev - 1) * 100;
}

function analyze(stock, quote, history) {
  if (history.length < 25) {
    return { status: "数据不足", posture: "等待数据", alerts: [{ level: "warn", title: "历史数据不足", body: "K 线样本少于 25 个交易日，暂不生成趋势信号。" }] };
  }
  const last = history.at(-1);
  const lastClose = Number(last.close);
  const ma10 = average(history.slice(-10));
  const ma20 = average(history.slice(-20));
  const ma60 = history.length >= 60 ? average(history.slice(-60)) : null;
  const ret5 = pctChange(lastClose, Number(history.at(-6)?.close));
  const ret20 = pctChange(lastClose, Number(history.at(-21)?.close));
  const last20 = history.slice(-20);
  const high20 = Math.max(...last20.map((row) => Number(row.high)));
  const low20 = Math.min(...last20.map((row) => Number(row.low)));
  const prior20High = Math.max(...history.slice(-21, -1).map((row) => Number(row.high)));
  const high60 = Math.max(...history.slice(-60).map((row) => Number(row.high)));
  const low60 = Math.min(...history.slice(-60).map((row) => Number(row.low)));
  const avgVol20 = average(last20, "volume");
  const volRatio = avgVol20 ? Number(last.volume) / avgVol20 : null;
  const drawdown60 = pctChange(lastClose, high60);
  const rangePosition60 = high60 > low60 ? ((lastClose - low60) / (high60 - low60)) * 100 : null;
  const aboveMa = lastClose > ma10 && lastClose > ma20;
  const maBullish = ma10 > ma20 && (!ma60 || ma20 > ma60);
  const nearBreakout = lastClose >= prior20High * 0.985;
  const breakout = lastClose > prior20High && (volRatio || 0) >= 1.15;
  const breakdown = lastClose < ma20 || lastClose < low20 * 1.03;

  let status = "震荡观察";
  let posture = "观察";
  let action = "等待关键点";
  let level = "warn";
  let reason = "尚未形成清晰关键点突破，先观察趋势与量能确认。";
  if (breakout && aboveMa && maBullish) {
    status = "关键点突破";
    posture = "试探仓";
    action = "可小仓试探";
    level = "good";
    reason = "价格放量突破近 20 日高点，符合趋势试探条件。";
  } else if (aboveMa && maBullish && nearBreakout) {
    status = "临近突破";
    posture = "等待放量";
    action = "突破后再试探";
    level = "good";
    reason = "均线结构偏强，但仍需放量突破关键点确认。";
  } else if (breakdown) {
    status = "趋势转弱";
    posture = "防守";
    action = "不加仓";
    level = "bad";
    reason = "价格跌破中短期趋势参考位，先控制风险，不向下摊平。";
  }

  const alerts = [];
  if (breakdown) alerts.push({ level: "bad", title: "趋势破位", body: `收盘价低于 MA20 或接近 20 日低位，防守线约 ${Math.min(ma20, low20 * 1.03).toFixed(2)} 元。` });
  if (drawdown60 !== null && drawdown60 <= -20) alerts.push({ level: "bad", title: "60 日回撤较深", body: `较 60 日高点回撤 ${drawdown60.toFixed(2)}%，需确认不是趋势性走弱。` });
  if ((quote.peTtm || 0) >= 80) alerts.push({ level: "warn", title: "估值较高", body: `PE(TTM) 约 ${quote.peTtm.toFixed(2)}x，业绩兑现慢时估值容错率较低。` });
  if ((quote.pb || 0) >= 10) alerts.push({ level: "warn", title: "PB 较高", body: `PB 约 ${quote.pb.toFixed(2)}x，需要高 ROE 或持续成长支撑。` });
  if ((volRatio || 0) >= 1.8 && (quote.changePct || 0) < 0) alerts.push({ level: "warn", title: "放量下跌", body: `成交量约为 20 日均量 ${volRatio.toFixed(2)} 倍且当日下跌，关注筹码松动。` });
  if (ret5 !== null && ret5 >= 15) alerts.push({ level: "warn", title: "短线涨幅较快", body: `5 日涨幅 ${ret5.toFixed(2)}%，追高风险上升，适合等回撤或突破确认。` });
  for (const risk of stock.risks || []) alerts.push({ level: risk.level || "warn", title: risk.title, body: risk.body });
  if (!alerts.length) alerts.push({ level: "good", title: "暂无高优先级预警", body: "趋势、估值和量能暂未触发高优先级风险阈值。" });

  return {
    status, posture, action, level, reason,
    ret5, ret20, ma10, ma20, ma60, high20, low20, prior20High, high60, low60,
    volRatio, drawdown60, rangePosition60,
    stopLine: Math.min(ma20, low20 * 1.03),
    addLine: prior20High * 1.03,
    alerts: alerts.slice(0, 6)
  };
}

async function updateStock(stock) {
  const quoteRaw = await fetchText(`https://qt.gtimg.cn/q=${txSymbol(stock)}`, "https://stockapp.finance.qq.com/");
  const quote = parseTencentQuote(quoteRaw, stock);
  let history = [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const klineRaw = await fetchText(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txSymbol(stock)},day,2025-01-01,${today},320,qfq`, "https://gu.qq.com/");
    history = parseTencentKlines(klineRaw, stock);
  } catch (error) {
    console.warn(`${stock.symbol} Tencent kline refresh failed: ${error.message}`);
    try {
      const klineRaw = await fetchText(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${stock.market === "SH" ? "1" : "0"}.${stock.code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&beg=20250101&end=20500101`, "https://quote.eastmoney.com/");
      history = parseEastmoneyKlines(klineRaw);
    } catch (fallbackError) {
      console.warn(`${stock.symbol} Eastmoney kline refresh failed: ${fallbackError.message}`);
    }
  }
  history = mergeQuoteIntoHistory(history, quote);
  return {
    ...stock,
    quote,
    history,
    analysis: analyze(stock, quote, history)
  };
}

await mkdir(dataDir, { recursive: true });
const watchlist = JSON.parse(await readFile(watchlistPath, "utf8"));
const stocks = [];
for (const stock of watchlist.stocks) {
  try {
    const updated = await updateStock(stock);
    stocks.push(updated);
    console.log(`Updated ${stock.symbol} ${stock.name}: ${updated.quote.price}; rows=${updated.history.length}`);
  } catch (error) {
    console.warn(`Failed to update ${stock.symbol} ${stock.name}: ${error.message}`);
    stocks.push({ ...stock, error: error.message, history: [], alerts: [] });
  }
}

const payload = {
  projectName: watchlist.projectName,
  source: "Tencent quote API + Eastmoney daily kline",
  updatedAt: new Date().toISOString(),
  stocks
};
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const first = stocks[0];
if (first?.quote) {
  await writeFile(legacyQuotePath, `${JSON.stringify({ source: payload.source, updatedAt: first.quote.updatedAt, quote: first.quote }, null, 2)}\n`, "utf8");
  await writeFile(legacyHistoryPath, `${JSON.stringify(first.history || [], null, 2)}\n`, "utf8");
}
