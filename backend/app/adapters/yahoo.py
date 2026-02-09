from __future__ import annotations

import html
import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx


class YahooQuoteAdapter:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    @staticmethod
    def _infer_currency(symbol: str) -> str:
        upper = symbol.upper()
        if upper.endswith(".SS") or upper.endswith(".SZ"):
            return "CNY"
        if upper.endswith(".HK"):
            return "HKD"
        if upper.endswith(".T"):
            return "JPY"
        if upper.endswith(".L"):
            return "GBP"
        return "USD"

    @staticmethod
    def _extract_name_from_title(page_title: str, symbol: str) -> str | None:
        decoded = html.unescape(page_title).strip()
        marker = f"({symbol})"
        if marker in decoded:
            return decoded.split(marker, 1)[0].strip()
        return None

    @staticmethod
    def _request_headers() -> dict[str, str]:
        # Keep headers minimal; heavy browser-like headers are more likely to be blocked by Yahoo.
        return {
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
            "Referer": "https://finance.yahoo.com/",
        }

    @staticmethod
    def _extract_cn_fund_code(symbol: str) -> str | None:
        normalized = symbol.strip().upper()
        if re.fullmatch(r"\d{6}", normalized):
            return normalized

        match_prefix = re.fullmatch(r"OF(\d{6})", normalized)
        if match_prefix:
            return match_prefix.group(1)

        match_suffix = re.fullmatch(r"(\d{6})\.OF", normalized)
        if match_suffix:
            return match_suffix.group(1)

        return None

    async def _fetch_quote_from_html(self, client: httpx.AsyncClient, symbol: str) -> dict | None:
        quote_url = f"https://finance.yahoo.com/quote/{symbol}?p={symbol}"
        resp = await client.get(quote_url)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403, 404, 429, 503}:
                return None
            raise
        text = resp.text

        price_match = re.search(r'data-testid="qsp-price">\s*([0-9][0-9,]*\.?[0-9]*)\s*<', text)
        if not price_match:
            return None

        raw_price = price_match.group(1).replace(",", "")
        try:
            price = Decimal(raw_price)
        except Exception:  # noqa: BLE001
            return None

        title_match = re.search(r"<title>(.*?)</title>", text, flags=re.S)
        name: str | None = None
        if title_match:
            name = self._extract_name_from_title(title_match.group(1), symbol)

        return {
            "price": price,
            "currency": self._infer_currency(symbol),
            "quoted_at_epoch": int(datetime.now(timezone.utc).timestamp()),
            "name": name,
            "market": None,
            "quote_type": None,
        }

    async def _fetch_quote_from_chart(self, client: httpx.AsyncClient, symbol: str) -> dict | None:
        chart_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        resp = await client.get(chart_url, params={"interval": "1d", "range": "5d"})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403, 404, 429, 503}:
                return None
            raise

        data = resp.json()
        chart = data.get("chart", {})
        if chart.get("error") is not None:
            return None

        results = chart.get("result") or []
        if not results:
            return None

        result = results[0]
        meta = result.get("meta") or {}
        quote_items = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        closes = quote_items.get("close") or []
        timestamps = result.get("timestamp") or []

        price_raw = meta.get("regularMarketPrice")
        if price_raw is None:
            for value in reversed(closes):
                if value is not None:
                    price_raw = value
                    break
        if price_raw is None:
            return None

        try:
            price = Decimal(str(price_raw))
        except Exception:  # noqa: BLE001
            return None

        quoted_at_epoch = meta.get("regularMarketTime")
        if not isinstance(quoted_at_epoch, int):
            if timestamps:
                quoted_at_epoch = int(timestamps[-1])
            else:
                quoted_at_epoch = int(datetime.now(timezone.utc).timestamp())

        name = meta.get("longName") or meta.get("shortName") or meta.get("symbol")
        market = meta.get("exchangeName") or meta.get("exchange")
        quote_type = meta.get("instrumentType")

        return {
            "price": price,
            "currency": meta.get("currency") or self._infer_currency(symbol),
            "quoted_at_epoch": quoted_at_epoch,
            "name": name,
            "market": market,
            "quote_type": quote_type,
        }

    async def _fetch_cn_fund_from_eastmoney(self, client: httpx.AsyncClient, symbol: str) -> dict | None:
        fund_code = self._extract_cn_fund_code(symbol)
        if not fund_code:
            return None

        fund_url = f"https://fundgz.1234567.com.cn/js/{fund_code}.js"
        resp = await client.get(fund_url, params={"rt": str(int(datetime.now(timezone.utc).timestamp()))})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {400, 401, 403, 404, 429, 500, 502, 503, 504}:
                return None
            raise

        match = re.search(r"jsonpgz\((\{.*\})\);?\s*$", resp.text.strip())
        if not match:
            return None

        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None

        fund_name = payload.get("name")
        if not isinstance(fund_name, str) or not fund_name.strip():
            return None

        price_raw = payload.get("gsz") or payload.get("dwjz")
        if price_raw is None:
            return None

        try:
            price = Decimal(str(price_raw))
        except Exception:  # noqa: BLE001
            return None

        quoted_at_epoch = int(datetime.now(timezone.utc).timestamp())
        gztime = payload.get("gztime")
        jzrq = payload.get("jzrq")
        shanghai_tz = timezone(timedelta(hours=8))
        if isinstance(gztime, str) and gztime.strip():
            try:
                dt = datetime.strptime(gztime.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=shanghai_tz)
                quoted_at_epoch = int(dt.astimezone(timezone.utc).timestamp())
            except ValueError:
                pass
        elif isinstance(jzrq, str) and jzrq.strip():
            try:
                dt = datetime.strptime(jzrq.strip(), "%Y-%m-%d").replace(hour=15, tzinfo=shanghai_tz)
                quoted_at_epoch = int(dt.astimezone(timezone.utc).timestamp())
            except ValueError:
                pass

        return {
            "price": price,
            "currency": "CNY",
            "quoted_at_epoch": quoted_at_epoch,
            "name": fund_name.strip(),
            "market": "Shenzhen",
            "quote_type": "MUTUAL_FUND",
        }

    async def lookup_quote(self, symbol: str) -> dict | None:
        async with httpx.AsyncClient(timeout=15.0, headers=self._request_headers(), follow_redirects=True) as client:
            chart_fallback = await self._fetch_quote_from_chart(client, symbol)
            if chart_fallback is not None:
                return chart_fallback

            html_fallback = await self._fetch_quote_from_html(client, symbol)
            if html_fallback is not None:
                return html_fallback

            return await self._fetch_cn_fund_from_eastmoney(client, symbol)

    async def fetch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        if not symbols:
            return {}

        params = {"symbols": ",".join(symbols)}
        async with httpx.AsyncClient(timeout=15.0, headers=self._request_headers(), follow_redirects=True) as client:
            results: dict[str, dict] = {}
            response_error: httpx.HTTPStatusError | None = None

            try:
                resp = await client.get(self.base_url, params=params)
                resp.raise_for_status()
                data = resp.json()
                rows = data.get("quoteResponse", {}).get("result", [])
                for row in rows:
                    fetched_symbol = row.get("symbol")
                    price = row.get("regularMarketPrice")
                    currency = row.get("currency") or "USD"
                    ts = row.get("regularMarketTime")
                    name = row.get("longName") or row.get("shortName") or row.get("displayName")
                    market = row.get("fullExchangeName") or row.get("exchange") or row.get("market")
                    quote_type = row.get("quoteType")
                    if fetched_symbol and price is not None:
                        results[fetched_symbol.upper()] = {
                            "price": Decimal(str(price)),
                            "currency": currency,
                            "quoted_at_epoch": ts,
                            "name": name,
                            "market": market,
                            "quote_type": quote_type,
                        }
            except httpx.HTTPStatusError as exc:
                response_error = exc
                if exc.response.status_code not in {401, 403, 404, 429, 500, 502, 503, 504}:
                    raise

            missing_symbols = [item.upper() for item in symbols if item.upper() not in results]
            if response_error is None and not missing_symbols:
                return results

            for missing_symbol in missing_symbols:
                html_fallback = await self._fetch_quote_from_html(client, missing_symbol)
                if html_fallback is not None:
                    results[missing_symbol] = html_fallback
                    continue

                chart_fallback = await self._fetch_quote_from_chart(client, missing_symbol)
                if chart_fallback is not None:
                    results[missing_symbol] = chart_fallback
                    continue

                cn_fund_fallback = await self._fetch_cn_fund_from_eastmoney(client, missing_symbol)
                if cn_fund_fallback is not None:
                    results[missing_symbol] = cn_fund_fallback

        return results
