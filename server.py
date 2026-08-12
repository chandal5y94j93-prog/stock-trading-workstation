#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local dev server for the trading workstation.

Serves static files and proxies public market APIs so the page can refresh
quotes, K-lines, minute data and capital-flow data without CORS issues.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}


def http_get(url, headers=None, timeout=12):
    h = dict(UA)
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def api_quote(codes):
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    raw = http_get(url)
    text = raw.decode("gbk", errors="replace")
    out = {}
    for line in text.strip().split(";"):
        line = line.strip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        code = key.replace("v_", "")
        parts = val.strip('"').split("~")
        if len(parts) < 48:
            continue
        out[code] = {
            "name": parts[1], "code": parts[2], "price": float(parts[3] or 0),
            "prev_close": float(parts[4] or 0), "open": float(parts[5] or 0),
            "volume": int(parts[6] or 0), "datetime": parts[30],
            "change": float(parts[31] or 0), "pct": float(parts[32] or 0),
            "high": float(parts[33] or 0), "low": float(parts[34] or 0),
            "amount": float(parts[37] or 0), "turnover": float(parts[38] or 0),
            "pe": float(parts[39] or 0), "mktcap": float(parts[45] or 0),
            "float_mktcap": float(parts[44] or 0), "pb": float(parts[46] or 0),
        }
    return out


def api_kline(code):
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,260,qfq"
    raw = http_get(url)
    data = json.loads(raw.decode("utf-8"))["data"][code]
    kline = data.get("qfqday") or data.get("day") or []
    return [{"date": r[0], "open": float(r[1]), "close": float(r[2]),
             "high": float(r[3]), "low": float(r[4]), "volume": float(r[5])} for r in kline]


def api_minute(code):
    url = f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}"
    raw = http_get(url)
    data = json.loads(raw.decode("utf-8"))["data"][code]["data"]
    lines = data.get("data", [])
    points = []
    for line in lines:
        p = line.split()
        if len(p) >= 4:
            points.append({"time": p[0], "price": float(p[1]), "volume": int(p[2]), "amount": float(p[3])})
    return {"points": points}


def api_fflow(em_code):
    params = urllib.parse.urlencode({
        "lmt": 0, "klt": 1, "secid": em_code,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
    })
    intraday = []
    for host in ("https://push2.eastmoney.com", "https://push2his.eastmoney.com"):
        try:
            raw = http_get(f"{host}/api/qt/stock/fflow/kline/get?{params}", headers={"Referer": "https://quote.eastmoney.com/"})
            data = json.loads(raw.decode("utf-8")).get("data") or {}
            klines = data.get("klines") or []
            for line in klines:
                p = line.split(",")
                if len(p) >= 6:
                    intraday.append({"time": p[0].replace(" ", "T"), "main": float(p[1]),
                                     "small": float(p[2]), "medium": float(p[3]),
                                     "large": float(p[4]), "super": float(p[5])})
            break
        except Exception:
            time.sleep(1)
    daily = []
    try:
        dparams = urllib.parse.urlencode({
            "lmt": 30, "klt": 101, "secid": em_code,
            "fields1": "f1,f2,f3,f7",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
        })
        durl = f"https://push2delay.eastmoney.com/api/qt/stock/fflow/daykline/get?{dparams}"
        ddata = json.loads(http_get(durl, headers={"Referer": "https://quote.eastmoney.com/"}).decode("utf-8")).get("data") or {}
        for line in ddata.get("klines") or []:
            p = line.split(",")
            if len(p) >= 13:
                daily.append({"date": p[0], "main": float(p[1]), "main_pct": float(p[6]),
                              "close": float(p[11]), "pct": float(p[12])})
    except Exception:
        pass
    return {"intraday": intraday, "daily": daily}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                if parsed.path == "/api/quote":
                    codes = (qs.get("codes", [""])[0]).split(",")
                    return self.send_json({"ok": True, "data": api_quote(codes)})
                if parsed.path == "/api/kline":
                    return self.send_json({"ok": True, "data": api_kline(qs["code"][0])})
                if parsed.path == "/api/minute":
                    return self.send_json({"ok": True, "data": api_minute(qs["code"][0])})
                if parsed.path == "/api/fflow":
                    return self.send_json({"ok": True, "data": api_fflow(qs["code"][0])})
                return self.send_json({"ok": False, "error": "unknown api"}, 404)
            except Exception as exc:  # noqa: BLE001
                return self.send_json({"ok": False, "error": str(exc)}, 502)
        return super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8901
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Trading workstation running at http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
