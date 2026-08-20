"""
Cline Header Sniffer — mitmproxy addon

Usage:
    mitmdump -s scripts/cline_header_sniffer.py -p 8083

Then run Cline through the proxy:
    HTTP_PROXY=http://127.0.0.1:8080 HTTPS_PROXY=http://127.0.0.1:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 cline

Or with proxychains:
    proxychains4 -f scripts/proxychains.conf cline
"""

import os
import time
from pathlib import Path
from typing import Any

from mitmproxy import ctx, http

HOME = Path.home()
LOG_DIR = Path(HOME, ".config/opencode/logs")
LOG_FILE = LOG_DIR / "cline_header_sniffer.log"

INTERESTING_PREFIXES = ("x-", "authorization", "user-agent", "content-type", "accept", "referer")


def _color(code: int, text: str) -> str:
    return f"\033[{code}m{text}\033[0m"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class ClineHeaderSniffer:
    def __init__(self) -> None:
        self._log_ready = False

    def _ensure_log_dir(self) -> None:
        if self._log_ready:
            return
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._log_ready = True

    def _write(self, text: str) -> None:
        print(text)
        try:
            self._ensure_log_dir()
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(text + "\n")
        except Exception as exc:
            print(f"[sniffer] log write failed: {exc}")

    def _format_headers(self, headers: "http.Headers", direction: str) -> str:
        lines: list[str] = []
        for key, value in headers.items():
            key_lower = key.lower()
            value_display = "<redacted>" if key_lower == "authorization" else value
            lines.append(f"    {key}: {value_display}")
        return "\n".join(lines)

    def request(self, flow: http.HTTPFlow) -> None:
        req = flow.request
        pretty = "\n".join([
            _color(35, f"[{_now()}] >>> {req.method} {req.pretty_url}"),
            _color(36, "--- Outgoing Request Headers ---"),
            self._format_headers(req.headers, ">>>"),
        ])
        self._write(pretty)

    def response(self, flow: http.HTTPFlow) -> None:
        res = flow.response
        if res is None:
            return
        pretty = "\n".join([
            _color(33, f"[{_now()}] <<< {res.status_code} {flow.request.pretty_url}"),
            _color(32, "--- Incoming Response Headers ---"),
            self._format_headers(res.headers, "<<<"),
        ])
        self._write(pretty)
        self._write("")


addons = [ClineHeaderSniffer()]
