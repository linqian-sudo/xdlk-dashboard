# 米法的自选股

这是一个多标的 A 股自选股网页看板，用于跟踪行情、图表走势、关键点信号和风险预警。

线上看板使用 GitHub Pages 发布，数据通过 GitHub Actions 在交易日收盘后自动更新。

## 功能

- 多标的自选股列表：股票代码、名称、主题、关注理由。
- 每日行情快照：最新价、涨跌幅、市值、PE、PB、成交额、换手率。
- 图表走势：收盘价、MA10、MA20，最多保留约 260 个交易日。
- 趋势分析：5 日/20 日涨跌、20 日关键区间、量能相对 20 日均量。
- 风险预警：趋势破位、60 日深回撤、估值过热、放量下跌、短线涨幅过快，以及每只股票配置的个性化风险。
- 利弗莫尔式操作纪律：关键点突破后试探、盈利后顺势加码、跌破防守线止损、不向下摊平。

## 文件说明

- `index.html`：GitHub Pages 首页。
- `assets/app.js`：前端渲染、走势图和信号逻辑。
- `assets/styles.css`：页面样式。
- `data/watchlist.json`：自选股配置。
- `data/watchlist-data.json`：自动生成的行情、K 线、分析和预警数据。
- `scripts/update-market-data.mjs`：批量更新腾讯行情快照和腾讯日 K 线；东方财富 K 线作为备用源。
- `.github/workflows/update-market-data.yml`：交易日自动更新，也支持手动触发。

## 添加标的

在 `data/watchlist.json` 中增加一项：

```json
{
  "symbol": "SH.688582",
  "market": "SH",
  "code": "688582",
  "name": "芯动联科",
  "theme": "高性能 MEMS 惯性传感器",
  "watchReason": "关注理由",
  "risks": [
    {
      "level": "warn",
      "title": "风险标题",
      "body": "风险描述"
    }
  ]
}
```

`market` 使用 `SH` 或 `SZ`。

## 本地更新

```bash
node scripts/update-market-data.mjs
```

## 风险提示

本看板只用于研究跟踪，不构成个性化投资建议、收益承诺或法律/税务意见。公开行情接口可能延迟、缺失或变更，重大资金操作仍需以交易软件、上市公司公告和个人风险承受能力为准。
