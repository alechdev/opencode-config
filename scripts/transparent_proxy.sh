#!/usr/bin/env bash
# Transparent proxy helper for Cline header sniffing.
# Redirects *only* known Cline HTTPS endpoints to mitmproxy.
#
# Usage:
#   sudo ./scripts/transparent_proxy.sh start
#   NODE_TLS_REJECT_UNAUTHORIZED=0 cline   # (in another terminal)
#   sudo ./scripts/transparent_proxy.sh stop

set -euo pipefail

PORT=8083
USER_ID=${SUDO_UID:-$(id -u)}
TABLE="nat"
CHAIN="OUTPUT"

# Cline endpoints we want to sniff (update as needed)
DOMAINS=(
  "api.cline.bot"
  "otel.cline.bot"
  "models.dev"
  "registry.npmjs.org"
)

function resolve_ips() {
  local ips=()
  for domain in "$@"; do
    # Only IPv4 — iptables doesn't accept IPv6 literals.
    local got
    got=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | head -4)
    if [[ -n "$got" ]]; then
      ips+=($got)
    else
      echo "[!] Warning: could not resolve $domain" >&2
    fi
  done
  printf "%s\n" "${ips[@]}" | sort -u
}

function add_rules() {
  local ips
  ips=$(resolve_ips "${DOMAINS[@]}")
  if [[ -z "$ips" ]]; then
    echo "[!] No IPs resolved. Aborting." >&2
    exit 1
  fi
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    echo "[+] Redirect $ip:443 -> :$PORT"
    iptables -t "$TABLE" -A "$CHAIN" -p tcp --dport 443 -d "$ip" -m owner --uid-owner "$USER_ID" -j REDIRECT --to-port "$PORT"
  done <<< "$ips"
}

function remove_rules() {
  # Delete every REDIRECT rule for our UID/port in the chain (repeat until none left)
  while true; do
    local line
    line=$(iptables -t "$TABLE" -L "$CHAIN" --line-numbers -n 2>/dev/null | \
           awk -v uid="$USER_ID" -v port="$PORT" '$0 ~ /REDIRECT/ && $0 ~ uid && $0 ~ port {print $1; exit}')
    [[ -z "$line" ]] && break
    echo "[-] Removing rule #$line"
    iptables -t "$TABLE" -D "$CHAIN" "$line" || break
  done
}

case "${1:-}" in
  start)
    remove_rules  # clean up stale rules first
    add_rules
    echo "[+] Starting mitmproxy in transparent mode (port $PORT)..."
    echo "    Press Ctrl+C to stop."
    # Bump file-descriptor limit so short bursts don't exhaust them.
    ulimit -n 4096
    exec mitmdump --mode "transparent@${PORT}" --showhost -s "$(dirname "$0")/cline_header_sniffer.py"
    ;;
  stop)
    remove_rules
    echo "[-] Done."
    ;;
  status)
    echo "[*] Current matching iptables rules:"
    iptables -t "$TABLE" -L "$CHAIN" -n --line-numbers | grep -E "REDIRECT|$PORT|$USER_ID" || echo "    (none)"
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
