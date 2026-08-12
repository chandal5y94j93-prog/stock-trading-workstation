#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily three-session A-share review pipeline.

Sessions:
  pre-market  盘前复盘（开盘前）
  midday      午间复盘（午间休市）
  evening     晚间复盘（收盘后）

The pipeline fetches quotes / K-line / minute / capital-flow data for the
watchlist, computes technical indicators and scores, updates the workstation
data files, and writes a dated markdown report. With --push it also commits
and pushes the changes to the configured git remote (GitHub Pages deploy).
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
SESSIONS = {"pre-market": "盘前", "midday": "午间", "evening": "晚间"}
SESSION_PLAN = {
    "pre-market": [
        "隔夜消息与外围市场过一遍，确认今日风险偏好。",
        "核对指数关键位：上证压力/支撑、自选板块强弱。",
        "按交易纪律选出今日观察清单，只做计划内交易。",
        "开盘前写清每笔的买入区间、止损价、目标价和仓位。",
    ],
    "midday": [
        "复盘上午强弱：强势方向是否延续，弱势方向是否破位。",
        "午后只看计划清单：回踩支撑分批低吸，不追盘中直线拉升。",
        "14:30 后不追单，尾盘 30 分钟只减不加。",
        "对资金流与指数背离的标的，下午优先减仓或观望。",
    ],
    "evening": [
        "收盘后按交易纪律完成复盘：是否符合计划、错误与情绪。",
        "记录当日成交、持仓、盈亏，更新模拟盘台账。",
        "整理明日观察清单与触发条件。",
        "单笔亏损超 -8% 的标的，明日开盘按纪律处理。",
    ],
}


def get(url, timeout=15, retries=3, headers=None):
    h = dict(UA)
    if headers:
        h.update(headers)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception:
            if i == retries - 1:
                return None
            time.sleep(1.0 * (i + 1))
    return None


def tencent_of(code):
    code = str(code)
    if code.startswith("1A") or code.startswith("1B"):
        return "sh" + code[2:]
    if code.startswith("399") or code.startswith("159") or code.startswith("300"):
        return "sz" + code
    if code.startswith(("6", "5")):
        return "sh" + code
    return "sz" + code


def em_of(code):
    tc = tencent_of(code)
    if tc.startswith("sh"):
        return "1." + tc[2:]
    return "0." + tc[2:]


def kind_of(code):
    code = str(code)
    if code in {"1A0001", "1B0688", "399905", "399300", "399006"} or code.startswith("399"):
        return "index"
    if code.startswith(("15", "51", "56", "58")):
        return "etf"
    if code.startswith("886"):
        return "block"
    return "stock"


def load_watchlist(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    items = []
    for w in data:
        items.append({
            "ths": str(w["ths"]),
            "tencent": w.get("tencent") or tencent_of(w["ths"]),
            "name": w.get("name", ""),
            "kind": w.get("kind") or kind_of(w["ths"]),
            "em": w.get("em") if w.get("em") is not None else (em_of(w["ths"]) if kind_of(w["ths"]) != "block" else None),
        })
    return items


def load_watchlist_from_ths(plist_path):
    """Read the THS shared-defaults plist on macOS and build a watchlist."""
    if not os.path.exists(plist_path):
        return None
    out = subprocess.run(["plutil", "-convert", "json", "-o", "-", plist_path],
                         capture_output=True, text=True, check=False)
    if out.returncode != 0:
        return None
    data = json.loads(out.stdout)
    items = []
    for row in data.get("SelfStockKey", []):
        code = str(row.get("StockCode", ""))
        if not code:
            continue
        items.append({
            "ths": code,
            "tencent": tencent_of(code),
            "name": "",
            "kind": kind_of(code),
            "em": em_of(code) if kind_of(code) != "block" else None,
        })
    return items


def fetch_quotes(items):
    codes = [i["tencent"] for i in items if i["kind"] != "block"]
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    raw = get(url, timeout=20)
    quotes = {}
    if not raw:
        return quotes
    for line in raw.decode("gbk", errors="replace").strip().split(";"):
        line = line.strip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        code = key.replace("v_", "")
        p = val.strip('"').split("~")
        if len(p) < 48:
            continue
        quotes[code] = {
            "name": p[1], "code": p[2], "price": float(p[3] or 0),
            "prev_close": float(p[4] or 0), "open": float(p[5] or 0),
            "volume": int(p[6] or 0), "datetime": p[30],
            "change": float(p[31] or 0), "pct": float(p[32] or 0),
            "high": float(p[33] or 0), "low": float(p[34] or 0),
            "amount": float(p[37] or 0), "turnover": float(p[38] or 0),
            "pe": float(p[39] or 0), "pb": float(p[46] or 0),
            "mktcap": float(p[45] or 0), "float_mktcap": float(p[44] or 0),
        }
    return quotes


def fetch_kline(code):
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,260,qfq"
    raw = get(url, timeout=20)
    if not raw:
        return []
    try:
        data = json.loads(raw.decode("utf-8"))["data"][code]
        kline = data.get("qfqday") or data.get("day") or []
        return [{"date": r[0], "open": float(r[1]), "close": float(r[2]),
                 "high": float(r[3]), "low": float(r[4]), "volume": float(r[5])} for r in kline]
    except Exception:
        return []


def fetch_minute(code):
    url = f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}"
    raw = get(url, timeout=20)
    if not raw:
        return {"points": [], "prev_close": None}
    try:
        data = json.loads(raw.decode("utf-8"))["data"][code]["data"]
        points = []
        for line in data.get("data", []):
            p = line.split()
            if len(p) >= 4:
                points.append({"time": p[0], "price": float(p[1]), "volume": int(p[2]), "amount": float(p[3])})
        return {"points": points, "prev_close": None}
    except Exception:
        return {"points": [], "prev_close": None}


def fetch_fflow_daily(em_code):
    params = urllib.parse.urlencode({
        "lmt": 30, "klt": 101, "secid": em_code,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
    })
    rows = []
    for host in ("https://push2his.eastmoney.com", "https://push2delay.eastmoney.com"):
        raw = get(f"{host}/api/qt/stock/fflow/daykline/get?{params}", timeout=8, retries=1,
                  headers={"Referer": "https://quote.eastmoney.com/"})
        if not raw:
            continue
        try:
            data = json.loads(raw.decode("utf-8")).get("data") or {}
            for line in data.get("klines") or []:
                p = line.split(",")
                if len(p) >= 13:
                    rows.append({"date": p[0], "main": float(p[1]), "main_pct": float(p[6]),
                                 "small": float(p[2]), "medium": float(p[3]),
                                 "large": float(p[4]), "super": float(p[5]),
                                 "close": float(p[11]), "pct": float(p[12])})
            if rows:
                break
        except Exception:
            continue
    return rows


def fetch_fflow_intraday(em_code):
    params = urllib.parse.urlencode({
        "lmt": 0, "klt": 1, "secid": em_code,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
    })
    for host in ("https://push2.eastmoney.com", "https://push2his.eastmoney.com"):
        raw = get(f"{host}/api/qt/stock/fflow/kline/get?{params}", timeout=8, retries=1,
                  headers={"Referer": "https://quote.eastmoney.com/"})
        if not raw:
            continue
        try:
            data = json.loads(raw.decode("utf-8")).get("data") or {}
            rows = []
            for line in data.get("klines") or []:
                p = line.split(",")
                if len(p) >= 6:
                    rows.append({"time": p[0].replace(" ", "T"), "main": float(p[1]),
                                 "small": float(p[2]), "medium": float(p[3]),
                                 "large": float(p[4]), "super": float(p[5])})
            if rows:
                return rows
        except Exception:
            continue
    return []


def fetch_all(items):
    quotes = fetch_quotes(items)
    result = []
    for w in items:
        item = dict(w)
        item["quote"] = quotes.get(w["tencent"], {}) if w["kind"] != "block" else {}
        if item["quote"] and not item["name"]:
            item["name"] = item["quote"].get("name", item["name"])
        if w["kind"] == "block":
            item["kline"], item["minute"] = [], {"points": [], "prev_close": None}
            item["fflow"], item["fflow_intraday"] = [], []
        else:
            item["kline"] = fetch_kline(w["tencent"])
            minute = fetch_minute(w["tencent"])
            minute["prev_close"] = item["quote"].get("prev_close")
            item["minute"] = minute
            if w["em"]:
                item["fflow"] = fetch_fflow_daily(w["em"])
                item["fflow_intraday"] = fetch_fflow_intraday(w["em"])
            else:
                item["fflow"], item["fflow_intraday"] = [], []
        result.append(item)
        print("fetched", item["name"] or item["ths"], "kline", len(item["kline"]), "fflow", len(item["fflow"]), flush=True)
        time.sleep(0.12)
    return {"fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "items": result}


def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def ema_series(vals, n):
    k = 2 / (n + 1)
    prev = None
    out = []
    for v in vals:
        prev = v if prev is None else v * k + prev * (1 - k)
        out.append(prev)
    return out


def macd(vals):
    if len(vals) < 35:
        return None
    ef = ema_series(vals, 12)
    es = ema_series(vals, 26)
    dif = [a - b for a, b in zip(ef, es)]
    dea = ema_series(dif, 9)
    hist = [(a - b) * 2 for a, b in zip(dif, dea)]
    return {"dif": dif[-1], "dea": dea[-1], "hist": hist[-1]}


def rsi(vals, n=14):
    if len(vals) <= n:
        return None
    gains, losses = [], []
    for i in range(1, len(vals)):
        ch = vals[i] - vals[i - 1]
        gains.append(max(ch, 0))
        losses.append(max(-ch, 0))
    ag = sum(gains[-n:]) / n
    al = sum(losses[-n:]) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def kdj(highs, lows, closes, n=9):
    if len(closes) < n:
        return None
    k, d = 50.0, 50.0
    for i in range(n - 1, len(closes)):
        lo = min(lows[i - n + 1:i + 1])
        hi = max(highs[i - n + 1:i + 1])
        rsv = 50.0 if hi == lo else (closes[i] - lo) / (hi - lo) * 100
        k = rsv / 3 + 2 * k / 3
        d = k / 3 + 2 * d / 3
    return {"k": k, "d": d, "j": 3 * k - 2 * d}


def analyze_items(market):
    analyses = []
    for item in market["items"]:
        kline = item["kline"]
        q = item.get("quote", {})
        base = {"name": item["name"], "ths": item["ths"], "tencent": item["tencent"],
                "kind": item["kind"], "quote": q}
        if not kline or not q:
            base["skip"] = True
            analyses.append(base)
            continue
        closes = [r["close"] for r in kline]
        highs = [r["high"] for r in kline]
        lows = [r["low"] for r in kline]
        last = closes[-1]
        ma5, ma10, ma20, ma60 = sma(closes, 5), sma(closes, 10), sma(closes, 20), sma(closes, 60)
        ind = {"ma5": ma5, "ma10": ma10, "ma20": ma20, "ma60": ma60,
               "macd": macd(closes), "rsi": rsi(closes), "kdj": kdj(highs, lows, closes)}
        score = 50
        trend = "震荡"
        if ma5 and ma10 and ma20:
            if last > ma5 > ma10 > ma20:
                trend, score = "多头", score + 14
            elif last < ma5 < ma10 < ma20:
                trend, score = "空头", score - 14
            elif last > ma20:
                trend, score = "偏多", score + 7
            else:
                trend, score = "偏空", score - 7
        if ma5 and ma10 and last > ma5 > ma10:
            score += 5
            if trend == "偏空":
                trend = "修复中"
        m = ind["macd"]
        if m:
            if m["dif"] > 0 and m["hist"] > 0:
                score += 8
            elif m["dif"] < 0 and m["hist"] < 0:
                score -= 8
            elif m["hist"] > 0:
                score += 4
            else:
                score -= 4
        r = ind["rsi"]
        if r is not None:
            if r > 75:
                score -= 8
            elif r < 25:
                score += 5
            elif r > 60:
                score += 4
            elif r < 40:
                score -= 3
        pct = q.get("pct", 0)
        if pct >= 7:
            score -= 6
        elif pct <= -5:
            score += 2
        main = item.get("fflow", [{}])[-1].get("main", 0) if item.get("fflow") else 0
        if main > 0:
            score += 8
        elif main < 0:
            score -= 8
        vols = [r["volume"] for r in kline[-21:-1]]
        if vols and len(kline) > 1:
            vavg = sum(vols) / len(vols)
            if vavg and kline[-1]["volume"] / vavg > 1.6:
                score += 5 if pct > 0 else -5
        score = max(5, min(95, score))
        amount = q.get("amount", 0) or 1
        recent = kline[-20:]
        support = min(rr["low"] for rr in recent)
        resistance = max(rr["high"] for rr in recent)
        if ma20:
            support = max(support, ma20 * 0.98)
            resistance = max(resistance, ma20)
        if item["kind"] in ("index", "block"):
            action = "观察"
        elif score >= 75:
            action = "持有/低吸"
        elif score >= 62:
            action = "持有"
        elif score >= 48:
            action = "持有/观望"
        elif score >= 36:
            action = "观望/高抛低吸"
        else:
            action = "减仓/回避"
        risk = "高" if abs(pct) >= 7 or score >= 80 or score <= 25 else ("中" if abs(pct) >= 4 else "低")
        base.update({
            "score": score, "trend": trend, "action": action, "risk": risk,
            "indicators": {"ma5": ma5, "ma10": ma10, "ma20": ma20, "ma60": ma60,
                           "macd_dif": m["dif"] if m else None, "macd_dea": m["dea"] if m else None,
                           "macd_hist": m["hist"] if m else None, "rsi": r,
                           "kdj_j": ind["kdj"]["j"] if ind["kdj"] else None},
            "support": support, "resistance": resistance,
            "main_flow": main, "main_ratio": main / (amount * 10000) * 100 if amount else 0,
            "narrative": "",
        })
        analyses.append(base)
    stocks = [a for a in analyses if a["kind"] in ("stock", "etf") and not a.get("skip")]
    avg = sum(a["score"] for a in stocks) / len(stocks) if stocks else 50
    up = sum(1 for a in stocks if (a["quote"].get("pct") or 0) > 0)
    down = sum(1 for a in stocks if (a["quote"].get("pct") or 0) < 0)
    total_main = sum(a.get("main_flow", 0) for a in stocks)
    sh = next((a for a in analyses if a["ths"] == "1A0001"), None)
    summary = (
        f"今日自选股整体偏{'强' if avg >= 60 else '弱' if avg <= 40 else '中性'}，"
        f"{up} 涨 {down} 跌，已统计标的主力资金合计 {'净流入' if total_main >= 0 else '净流出'} "
        f"{abs(total_main) / 1e8:.2f} 亿。"
    )
    if sh and not sh.get("skip"):
        summary += f" 上证指数 {sh['quote'].get('price', 0):.2f}（{sh['quote'].get('pct', 0):+.2f}%），大盘环境{'偏暖' if (sh['quote'].get('pct') or 0) > 0 else '偏弱'}。"
    return {"generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "portfolio": {"avg_score": avg, "up_count": up, "down_count": down,
                          "total_main": total_main, "shanghai": sh, "count": len(stocks)},
            "summary": summary, "items": analyses}


def build_report(date_str, session, market, analysis):
    label = SESSIONS[session]
    lines = [f"# 自选股{label}复盘报告（{date_str}）", ""]
    lines.append(f"> 数据时间：{market.get('fetched_at', '')}  ·  自动流水线生成，不构成投资建议")
    lines.append("")
    lines.append("## 大盘环境")
    lines.append("")
    lines.append("| 指数 | 现价 | 涨跌% |")
    lines.append("| --- | --- | --- |")
    for a in analysis["items"]:
        if a["kind"] == "index" and not a.get("skip"):
            q = a["quote"]
            lines.append(f"| {a['name']} | {q.get('price', 0):.2f} | {q.get('pct', 0):+.2f} |")
    lines.append("")
    lines.append("## 组合概况")
    lines.append("")
    lines.append(analysis["summary"])
    lines.append("")
    lines.append("## 自选股一览")
    lines.append("")
    lines.append("| 代码 | 名称 | 现价 | 涨跌% | 评分 | 趋势 | 建议 | 支撑 | 压力 | 主力净流入 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for a in analysis["items"]:
        if a.get("skip"):
            lines.append(f"| {a['ths']} | {a['name']} | -- | -- | -- | -- | 待确认 | -- | -- | -- |")
            continue
        q = a["quote"]
        mf = a.get("main_flow", 0)
        mf_txt = f"{mf / 1e8:+.2f}亿" if mf else "资金流暂缺"
        lines.append(f"| {a['ths']} | {a['name']} | {q.get('price', 0):.2f} | {q.get('pct', 0):+.2f} | "
                     f"{a['score']} | {a['trend']} | {a['action']} | {a['support']:.2f} | {a['resistance']:.2f} | {mf_txt} |")
    lines.append("")
    lines.append("## 操作计划")
    lines.append("")
    for i, item in enumerate(SESSION_PLAN[session], 1):
        lines.append(f"{i}. {item}")
    lines.append("")
    lines.append("## 风险提示")
    lines.append("")
    lines.append("- 数据来自公开行情接口，可能有延迟或缺失（资金流字段“暂缺”表示接口未返回当日数据）。")
    lines.append("- 技术指标与 AI 评分是辅助工具，不构成投资建议；止损按交易纪律执行。")
    lines.append("- 模拟盘持仓与成交记录由同花顺服务器托管，本地不缓存明文，需手动导入台账。")
    lines.append("")
    return "\n".join(lines)


def write_site(repo, market, analysis, sim, session):
    data_dir = os.path.join(repo, "data")
    docs_dir = os.path.join(repo, "docs", "reports")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(docs_dir, exist_ok=True)
    with open(os.path.join(data_dir, "market.json"), "w", encoding="utf-8") as f:
        json.dump(market, f, ensure_ascii=False, indent=1)
    with open(os.path.join(data_dir, "analysis.json"), "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=1)
    with open(os.path.join(data_dir, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.__MARKET__ = ")
        json.dump(market, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\nwindow.__ANALYSIS__ = ")
        json.dump(analysis, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\nwindow.__SIM__ = ")
        json.dump(sim, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    meta = {"generated_at": market["fetched_at"], "session": session,
            "count": len(market["items"]), "source": "auto"}
    with open(os.path.join(data_dir, "last_run.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    date_str = market["fetched_at"][:10]
    report = build_report(date_str, session, market, analysis)
    report_name = f"{date_str}-{session}.md"
    with open(os.path.join(docs_dir, report_name), "w", encoding="utf-8") as f:
        f.write(report)
    index_path = os.path.join(docs_dir, "index.json")
    idx = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            idx = json.load(f).get("reports", [])
    idx = [r for r in idx if not (r.get("date") == date_str and r.get("session") == session)]
    idx.append({"date": date_str, "session": session, "file": report_name,
                "created_at": market["fetched_at"]})
    idx.sort(key=lambda r: (r["date"], r["session"]), reverse=True)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({"reports": idx}, f, ensure_ascii=False, indent=1)
    print("site updated:", report_name, flush=True)


def load_sim(repo):
    path = os.path.join(repo, "data", "sim.json")
    if not os.path.exists(path):
        return {"account": "模拟炒股*gutz", "fund_account": "118977367",
                "positions": [], "orders": [], "note": "持仓与成交由同花顺服务器托管，本地未缓存明文；请手动导入台账。"}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("account", "模拟炒股*gutz")
        data.setdefault("fund_account", "118977367")
        data.setdefault("positions", [])
        data.setdefault("orders", [])
        return data
    except Exception:
        return {"account": "模拟炒股*gutz", "fund_account": "118977367", "positions": [], "orders": []}


def git_push(repo):
    os.chdir(repo)
    subprocess.run(["git", "add", "-A"], check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
        return False
    who = subprocess.run(["git", "config", "user.name"], capture_output=True, text=True).stdout.strip()
    if not who:
        subprocess.run(["git", "config", "user.name", "trading-bot"], check=True)
        subprocess.run(["git", "config", "user.email", "trading-bot@users.noreply.github.com"], check=True)
    subprocess.run(["git", "commit", "-m", f"daily review {datetime.now():%Y-%m-%d %H:%M}"], check=True)
    for _ in range(3):
        try:
            subprocess.run(["git", "pull", "--rebase", "--autostash"], check=True)
            subprocess.run(["git", "push"], check=True)
            return True
        except Exception:
            time.sleep(5)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", choices=list(SESSIONS), required=True)
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--watchlist", default=None)
    ap.add_argument("--ths-plist", default=None,
                    help="macOS THS shared-defaults plist; syncs watchlist from the app when provided")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    watch_path = args.watchlist or os.path.join(args.repo, "watchlist.json")
    items = load_watchlist(watch_path)
    if args.ths_plist:
        local = load_watchlist_from_ths(args.ths_plist)
        if local:
            items = local
            with open(watch_path, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=1)
            print("watchlist synced from THS:", len(items), flush=True)

    market = fetch_all(items)
    analysis = analyze_items(market)
    sim = load_sim(args.repo)
    write_site(args.repo, market, analysis, sim, args.session)
    if args.push:
        pushed = git_push(args.repo)
        print("git push:", "yes" if pushed else "no changes", flush=True)


if __name__ == "__main__":
    main()
