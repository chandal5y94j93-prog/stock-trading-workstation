# 股票交易工作台

本地运行的 A 股交易辅助工作台，直接读取同花顺 Mac 版的自选股数据，内置行情看盘、AI 评分建议、交易纪律打卡、模拟盘台账和 GitHub 同类项目参考。

## 功能

- 自选股列表：自动读取同花顺本地自选（当前 31 个标的，含指数与 ETF）。
- 行情看盘：实时报价、日K（MA5/10/20/60 + MACD + 成交量）、分时图、主力资金流向。
- AI 建议：基于均线、MACD、RSI、KDJ、BOLL、量能和主力资金生成评分、趋势、支撑压力与操作建议。
- 交易纪律：核心纪律打卡、违规计数、每日复盘表单，数据保存在本机浏览器。
- 模拟盘：展示已识别的同花顺模拟账户信息，支持持仓/操作记录导入、添加、导出。
- GitHub 参考：整理 3 个同类开源项目及其可借鉴功能。

## 运行

```bash
cd outputs/trading-workstation
python3 server.py
```

打开 <http://127.0.0.1:8901> 即可使用。刷新按钮会通过本地服务代理腾讯行情与东方财富资金流接口，避免浏览器跨域问题。

也可以直接用浏览器打开 `index.html`，页面会加载内置的数据快照；但实时刷新功能需要启动 `server.py`。

## 目录

```text
index.html            页面
styles.css            样式
app.js                交互逻辑
server.py             本地服务 + 行情代理
data/data.js          行情与 AI 分析数据快照
docs/交易纪律.md       交易纪律手册
docs/ai分析报告-2026-08-07.md  2026-08-07 AI 分析报告
docs/ai分析报告-2026-08-12.md  2026-08-12 盘中复盘报告
lib/                  ECharts / Lucide 本地依赖
```

## 数据说明

- 自选股读取自 `~/Library/Containers/cn.com.10jqka.macstockPro/Data/Library/Group Containers/74EG3R33SN.group.SharedDefaults/...` 与同花顺云端同步。
- 行情、K线、分时来自腾讯公开接口；资金流向来自东方财富公开接口。
- 数据快照生成时间：2026-08-07 收盘后。
- 模拟盘持仓与成交记录存储在服务器端，本地未缓存明文；工作台台账为本地导入维护。

## 每日自动化

复盘流水线每天自动运行三次（交易日）：

- 盘前 08:50：`pre-market`
- 午间 12:05：`midday`
- 晚间 20:05：`evening`

云端由 GitHub Actions 定时执行 `scripts/pipeline.py`，自动抓行情、生成分析、写报告并部署 GitHub Pages；本地可运行 `scripts/run_scheduled.sh` 同步自选股并推送。

本机 LaunchAgent 模板在 `scripts/com.codex.trading-workstation.plist`，如需在 Mac 上启用（需在普通终端执行）：

```bash
cp scripts/com.codex.trading-workstation.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/20 20 12 61 79 80 81 98 701 33 100 204 250 395 398 399 400id -u) ~/Library/LaunchAgents/com.codex.trading-workstation.plist
```

## 云端部署

- 站点：<https://chandal5y94j93-prog.github.io/stock-trading-workstation/>
- 仓库：<https://github.com/chandal5y94j93-prog/stock-trading-workstation>
- 部署方式：GitHub Actions（Scheduled Reviews 单工作流盘前/午间/晚间三时段 + 推送即部署）

## 风险声明

本工具仅用于学习与模拟盘训练，不构成投资建议。技术指标和 AI 解读均可能失效，最终决策由使用者自行承担。
