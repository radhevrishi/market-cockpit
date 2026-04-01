#!/usr/bin/env python3
"""
Market Cockpit — Telegram Movers Alert
Sends top midcap & smallcap movers/losers to Telegram twice daily.

Usage:
  python telegram_movers_alert.py          # Send alert now
  python telegram_movers_alert.py --test   # Send test message
"""

import asyncio
import sys
import json
from datetime import datetime
from typing import Dict, List, Any

import requests
from telegram import Bot

# ── Config ──────────────────────────────────────────────────────────────
TOKEN = "8401991707:AAGpZj1UgW4sJdLm7FLhedC2nBwxUtgXFIc"
CHAT_ID = 5057319640
API_BASE = "https://market-cockpit.vercel.app/api/market"

# NSE direct endpoints as fallback
NSE_BASE = "https://www.nseindia.com"
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://www.nseindia.com/",
}


def get_nse_cookies() -> str:
    """Get fresh NSE cookies."""
    try:
        r = requests.get(NSE_BASE, headers={"User-Agent": NSE_HEADERS["User-Agent"]}, timeout=10)
        cookies = "; ".join(f"{k}={v}" for k, v in r.cookies.items())
        return cookies
    except Exception:
        return ""


def fetch_nse_index(index_name: str, cookies: str) -> List[Dict]:
    """Fetch stocks from an NSE index."""
    try:
        url = f"{NSE_BASE}/api/equity-stockIndices?index={requests.utils.quote(index_name)}"
        headers = {**NSE_HEADERS, "Cookie": cookies}
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            return data.get("data", [])
    except Exception as e:
        print(f"[WARN] Failed to fetch {index_name}: {e}")
    return []


def fetch_movers_from_nse() -> Dict[str, List[Dict]]:
    """Fetch midcap and smallcap data directly from NSE."""
    cookies = get_nse_cookies()
    if not cookies:
        raise Exception("Could not get NSE cookies")

    midcap50 = fetch_nse_index("NIFTY MIDCAP 50", cookies)
    midcap100 = fetch_nse_index("NIFTY MIDCAP 100", cookies)
    smallcap50 = fetch_nse_index("NIFTY SMLCAP 50", cookies)
    smallcap100 = fetch_nse_index("NIFTY SMLCAP 100", cookies)

    def parse_stocks(data: List[Dict], label: str) -> List[Dict]:
        stocks = []
        for item in data:
            sym = item.get("symbol", "")
            if not sym or sym == "NIFTY MIDCAP 50":
                continue
            pct = item.get("pChange", 0)
            if isinstance(pct, str):
                try:
                    pct = float(pct)
                except ValueError:
                    pct = 0
            stocks.append({
                "ticker": sym,
                "company": item.get("meta", {}).get("companyName", sym) if isinstance(item.get("meta"), dict) else sym,
                "price": item.get("lastPrice", 0),
                "changePercent": round(pct, 2),
                "change": round(item.get("change", 0), 2) if isinstance(item.get("change"), (int, float)) else 0,
                "cap": label,
            })
        return stocks

    seen = set()
    all_stocks = []
    for stocks_data, label in [
        (midcap50, "Mid"), (midcap100, "Mid"),
        (smallcap50, "Sml"), (smallcap100, "Sml"),
    ]:
        for s in parse_stocks(stocks_data, label):
            if s["ticker"] not in seen:
                seen.add(s["ticker"])
                all_stocks.append(s)

    gainers = sorted([s for s in all_stocks if s["changePercent"] > 0], key=lambda x: -x["changePercent"])
    losers = sorted([s for s in all_stocks if s["changePercent"] < 0], key=lambda x: x["changePercent"])

    return {
        "total": len(all_stocks),
        "gainers": gainers[:15],
        "losers": losers[:15],
        "avg_change": round(sum(s["changePercent"] for s in all_stocks) / max(len(all_stocks), 1), 2),
    }


def build_alert_message(data: Dict) -> str:
    """Build a nicely formatted Telegram message."""
    now = datetime.now()
    date_str = now.strftime("%d %b %Y")
    time_str = now.strftime("%H:%M IST")

    total = data["total"]
    gainers = data["gainers"]
    losers = data["losers"]
    avg = data["avg_change"]

    avg_emoji = "\U0001F7E2" if avg >= 0 else "\U0001F534"
    market_mood = "BULLISH" if avg > 0.5 else "BEARISH" if avg < -0.5 else "MIXED"

    lines = []
    lines.append(f"\U0001F4CA *Market Cockpit — Mid & Small Cap Alert*")
    lines.append(f"\U0001F4C5 {date_str} | \U0001F552 {time_str}")
    lines.append(f"")
    lines.append(f"{avg_emoji} *Market Mood: {market_mood}* (avg {'+' if avg > 0 else ''}{avg}%)")
    lines.append(f"\U0001F4C8 {len([s for s in data.get('all', gainers) if True])} stocks tracked | {len(gainers)} gainers | {len(losers)} losers")
    lines.append(f"")

    # Top Gainers
    lines.append(f"\U0001F680 *TOP GAINERS*")
    lines.append(f"```")
    for i, g in enumerate(gainers[:10], 1):
        cap = f"[{g['cap']}]"
        pct = f"+{g['changePercent']:.1f}%"
        price = f"\u20B9{g['price']:,.0f}" if g['price'] else ""
        lines.append(f"{i:>2}. {g['ticker']:<14} {pct:>7}  {price:>8} {cap}")
    lines.append(f"```")
    lines.append(f"")

    # Top Losers
    lines.append(f"\U0001F4C9 *TOP LOSERS*")
    lines.append(f"```")
    for i, l in enumerate(losers[:10], 1):
        cap = f"[{l['cap']}]"
        pct = f"{l['changePercent']:.1f}%"
        price = f"\u20B9{l['price']:,.0f}" if l['price'] else ""
        lines.append(f"{i:>2}. {l['ticker']:<14} {pct:>7}  {price:>8} {cap}")
    lines.append(f"```")
    lines.append(f"")

    # Big movers (>4%)
    big_up = [g for g in gainers if g["changePercent"] >= 4]
    big_down = [l for l in losers if l["changePercent"] <= -4]
    if big_up or big_down:
        lines.append(f"\u26A1 *BIG MOVERS (4%+)*")
        for s in big_up[:5]:
            lines.append(f"  \U0001F7E2 {s['ticker']} +{s['changePercent']:.1f}% [{s['cap']}]")
        for s in big_down[:5]:
            lines.append(f"  \U0001F534 {s['ticker']} {s['changePercent']:.1f}% [{s['cap']}]")
        lines.append(f"")

    lines.append(f"\U0001F310 [View Dashboard](https://market-cockpit.vercel.app/movers)")
    lines.append(f"_Powered by Market Cockpit_")

    return "\n".join(lines)


def fetch_movers_from_api() -> Dict[str, List[Dict]]:
    """Fetch from our deployed Market Cockpit API (works from cloud)."""
    all_stocks = []
    seen = set()

    for idx, label in [("midsmall50", "Mid"), ("smallcap150", "Sml"), ("midcap150", "Mid")]:
        try:
            url = f"{API_BASE}/quotes?market=india&index={idx}"
            r = requests.get(url, timeout=30)
            if r.status_code == 200:
                data = r.json()
                for s in data.get("stocks", []):
                    tk = s.get("ticker", "")
                    if tk and tk not in seen:
                        seen.add(tk)
                        grp = (s.get("indexGroup", "") or "").lower()
                        cap = "Mid" if "midcap" in grp or "mid" in grp else "Sml"
                        all_stocks.append({
                            "ticker": tk,
                            "company": s.get("company", tk),
                            "price": s.get("price", 0),
                            "changePercent": round(s.get("changePercent", 0), 2),
                            "change": round(s.get("change", 0), 2),
                            "cap": cap,
                        })
        except Exception as e:
            print(f"[WARN] Failed API fetch {idx}: {e}")

    gainers = sorted([s for s in all_stocks if s["changePercent"] > 0], key=lambda x: -x["changePercent"])
    losers = sorted([s for s in all_stocks if s["changePercent"] < 0], key=lambda x: x["changePercent"])

    return {
        "total": len(all_stocks),
        "gainers": gainers[:15],
        "losers": losers[:15],
        "avg_change": round(sum(s["changePercent"] for s in all_stocks) / max(len(all_stocks), 1), 2),
    }


async def send_alert():
    """Fetch data and send Telegram alert."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Fetching movers data...")

    # Try API first (works from cloud), fallback to NSE direct
    try:
        data = fetch_movers_from_api()
        if data["total"] == 0:
            data = fetch_movers_from_nse()
    except Exception:
        try:
            data = fetch_movers_from_nse()
        except Exception as e:
            print(f"[ERROR] All sources failed: {e}")
            return False

    if not data["gainers"] and not data["losers"]:
        print("[WARN] No movers data — market may be closed")
        # Send a brief market-closed message
        bot = Bot(token=TOKEN)
        await bot.send_message(
            chat_id=CHAT_ID,
            text="\U0001F4CA *Market Cockpit*\n\nMarket is closed. No movers data available.\n\n_Next alert during market hours._",
            parse_mode="Markdown",
        )
        return True

    msg = build_alert_message(data)
    print(f"[INFO] Sending alert ({data['total']} stocks, {len(data['gainers'])} gainers, {len(data['losers'])} losers)...")

    bot = Bot(token=TOKEN)
    await bot.send_message(
        chat_id=CHAT_ID,
        text=msg,
        parse_mode="Markdown",
        disable_web_page_preview=True,
    )
    print(f"[OK] Alert sent successfully!")
    return True


async def send_test():
    """Send a test message."""
    bot = Bot(token=TOKEN)
    await bot.send_message(
        chat_id=CHAT_ID,
        text="\u2705 *Market Cockpit Bot Connected*\n\nYou'll receive mid & small cap movers alerts twice daily during market hours.\n\n\U0001F310 [View Dashboard](https://market-cockpit.vercel.app/movers)",
        parse_mode="Markdown",
        disable_web_page_preview=True,
    )
    print("[OK] Test message sent!")


if __name__ == "__main__":
    if "--test" in sys.argv:
        asyncio.run(send_test())
    else:
        asyncio.run(send_alert())
