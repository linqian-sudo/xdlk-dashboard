# 芯动联科长期投资看板

这是一个面向 `688582.SH 芯动联科` 的静态网页看板，用于跟踪长期投资 thesis、每日行情、估值温度、仓位纪律和关键风险。

## 功能

- `index.html`：GitHub Pages 首页看板。
- `data/quote.json`：最近一次行情快照。
- `data/quote-history.json`：每日行情历史，最多保留约 260 条。
- `scripts/update-market-data.mjs`：抓取腾讯行情接口并更新数据。
- `.github/workflows/update-market-data.yml`：交易日 16:45 左右自动更新，也支持手动触发。

## 本地更新

```bash
node scripts/update-market-data.mjs
```

## 风险提示

本看板只用于研究跟踪，不构成投资建议。公开行情接口可能延迟、缺失或变更，重大投资决策仍需以交易软件、公司公告和个人风险承受能力为准。
