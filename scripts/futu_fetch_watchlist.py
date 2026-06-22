#!/usr/bin/env python3
"""Fetch watchlist quotes and daily K-lines from local Futu OpenD.

The script is intentionally optional: it prints {"ok": false, ...} when the
Futu SDK or OpenD is unavailable, so the Node updater can fall back cleanly.
"""

from __future__ import annotations

import datetime as dt
import contextlib
import io
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_PACKAGES = ROOT / ".python-packages"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))


def as_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def as_yi(value):
    number = as_float(value)
    if number is None:
        return None
    return number / 100000000 if abs(number) > 1000000 else number


def row_value(row, *names):
    for name in names:
        try:
            value = row.get(name)
        except AttributeError:
            value = None
        if value is not None and value == value:
            return value
    return None


def to_records(frame):
    if hasattr(frame, "to_dict"):
        return frame.to_dict("records")
    return []


def main():
    import_output = io.StringIO()
    try:
        with contextlib.redirect_stdout(import_output), contextlib.redirect_stderr(import_output):
            from futu import AuType, KLType, OpenQuoteContext, RET_OK
    except BaseException as exc:  # pragma: no cover - environment dependent
        reason = import_output.getvalue().strip() or str(exc)
        print(json.dumps({"ok": False, "reason": f"Futu SDK unavailable: {reason}"}))
        return 0

    watchlist_path = ROOT / "data" / "watchlist.json"
    watchlist = json.loads(watchlist_path.read_text(encoding="utf-8"))
    stocks = watchlist.get("stocks", [])
    codes = [stock["symbol"] for stock in stocks]

    host = os.getenv("FUTU_OPEND_HOST", "127.0.0.1")
    port = int(os.getenv("FUTU_OPEND_PORT", "11111"))
    start = os.getenv("FUTU_KLINE_START", "2025-01-01")
    end = os.getenv("FUTU_KLINE_END", dt.date.today().isoformat())

    quote_ctx = None
    try:
        quote_ctx = OpenQuoteContext(host=host, port=port)
        ret, snapshot = quote_ctx.get_market_snapshot(codes)
        if ret != RET_OK:
            print(json.dumps({"ok": False, "reason": f"OpenD snapshot failed: {snapshot}"}))
            return 0

        quotes = {}
        for row in to_records(snapshot):
            code = row_value(row, "code")
            if not code:
                continue
            price = as_float(row_value(row, "last_price", "cur_price"))
            prev_close = as_float(row_value(row, "prev_close_price", "last_close_price"))
            change = as_float(row_value(row, "change_price", "change"))
            if change is None and price is not None and prev_close:
                change = price - prev_close
            change_pct = as_float(row_value(row, "change_rate"))
            if change_pct is None and change is not None and prev_close:
                change_pct = change / prev_close * 100
            quotes[code] = {
                "name": row_value(row, "stock_name", "name"),
                "code": str(code).split(".")[-1],
                "symbol": code,
                "market": str(code).split(".")[0],
                "tradeTime": row_value(row, "update_time", "data_time"),
                "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "price": price,
                "prevClose": prev_close,
                "open": as_float(row_value(row, "open_price")),
                "high": as_float(row_value(row, "high_price")),
                "low": as_float(row_value(row, "low_price")),
                "change": change,
                "changePct": change_pct,
                "volumeShares": as_float(row_value(row, "volume")),
                "amountYi": as_yi(row_value(row, "turnover")),
                "turnover": as_float(row_value(row, "turnover_rate")),
                "peTtm": as_float(row_value(row, "pe_ttm", "pe_rate")),
                "pb": as_float(row_value(row, "pb_rate", "pb")),
                "marketCapYi": as_yi(row_value(row, "market_val")),
                "floatMarketCapYi": as_yi(row_value(row, "circulating_market_val")),
            }

        histories = {}
        errors = {}
        for code in codes:
            try:
                ret, kline, _ = quote_ctx.request_history_kline(
                    code,
                    start=start,
                    end=end,
                    ktype=KLType.K_DAY,
                    autype=AuType.QFQ,
                )
                if ret != RET_OK:
                    errors[code] = str(kline)
                    histories[code] = []
                    continue
                rows = []
                for row in to_records(kline):
                    rows.append({
                        "date": str(row_value(row, "time_key", "date"))[:10],
                        "open": as_float(row_value(row, "open")),
                        "close": as_float(row_value(row, "close")),
                        "high": as_float(row_value(row, "high")),
                        "low": as_float(row_value(row, "low")),
                        "volume": as_float(row_value(row, "volume")),
                        "amountYi": as_yi(row_value(row, "turnover")),
                        "amplitude": None,
                        "changePct": as_float(row_value(row, "change_rate")),
                        "change": as_float(row_value(row, "change")),
                        "turnover": as_float(row_value(row, "turnover_rate")),
                    })
                histories[code] = [row for row in rows if row["date"] and row["close"] is not None][-260:]
            except Exception as exc:  # pragma: no cover - environment dependent
                errors[code] = str(exc)
                histories[code] = []

        print(json.dumps({
            "ok": True,
            "source": f"Futu OpenD {host}:{port}",
            "quotes": quotes,
            "histories": histories,
            "errors": errors,
        }))
        return 0
    except Exception as exc:  # pragma: no cover - environment dependent
        print(json.dumps({"ok": False, "reason": f"OpenD unavailable: {exc}"}))
        return 0
    finally:
        if quote_ctx is not None:
            quote_ctx.close()


if __name__ == "__main__":
    raise SystemExit(main())
