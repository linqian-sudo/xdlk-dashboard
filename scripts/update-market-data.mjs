import { writeFile, readFile, mkdir } from "node:fs/promises";
import https from "node:https";

const url = "https://qt.gtimg.cn/q=sh688582";
const outputPath = new URL("../data/quote.json", import.meta.url);
const historyPath = new URL("../data/quote-history.json", import.meta.url);

function fetchText(target) {
  return new Promise((resolve, reject) => {
    https.get(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 xdlk-dashboard",
        "Referer": "https://stockapp.finance.qq.com/"
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
  });
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

function parseTencentQuote(raw) {
  const match = raw.match(/="([^"]+)"/);
  if (!match) throw new Error("Unexpected Tencent quote payload");
  const f = match[1].split("~");
  const tradeTime = parseTradeTime(f[30]);
  return {
    source: "Tencent quote API",
    updatedAt: tradeTime?.iso || new Date().toISOString(),
    quote: {
      name: "芯动联科",
      code: f[2],
      tradeTime: tradeTime?.label || null,
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
    }
  };
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyPath, "utf8"));
  } catch {
    return [];
  }
}

function mergeHistory(history, payload) {
  const key = payload.quote.tradeTime?.slice(0, 10) || payload.updatedAt.slice(0, 10);
  const compact = {
    date: key,
    price: payload.quote.price,
    changePct: payload.quote.changePct,
    amountYi: payload.quote.amountYi,
    turnover: payload.quote.turnover,
    marketCapYi: payload.quote.marketCapYi,
    peTtm: payload.quote.peTtm
  };
  const next = history.filter((row) => row.date !== key);
  next.push(compact);
  return next.slice(-260);
}

await mkdir(new URL("../data", import.meta.url), { recursive: true });
const raw = await fetchText(url);
const payload = parseTencentQuote(raw);
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
const history = mergeHistory(await readHistory(), payload);
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`Updated ${payload.quote.name} ${payload.quote.tradeTime}: ${payload.quote.price}`);
