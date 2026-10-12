#!/usr/bin/env bash
# Tailmance domain, app-link, legal-page and e-mail reputation check (read-only; only GET/HEAD/DNS lookups).
# Usage: scripts/verify-domain-setup.sh <domain> [dkim-selector]
set -u
DOMAIN="${1:-}"; DKIM_SELECTOR="${2:-}"
BUNDLE="tailmanceapp.wordpress.com"
[ -n "$DOMAIN" ] || { echo "Usage: $0 <domain> [dkim-selector]"; exit 2; }
case "$DOMAIN" in *[!a-z0-9.-]*|.*|*..*) echo "Invalid domain: $DOMAIN"; exit 2;; esac
for tool in curl dig; do command -v "$tool" >/dev/null || { echo "$tool is required"; exit 2; }; done
FAIL=0; WARN=0
ok(){ echo "PASS  $*"; }
bad(){ echo "FAIL  $*"; FAIL=$((FAIL+1)); }
warn(){ echo "WARN  $*"; WARN=$((WARN+1)); }
CURL=(curl -sS --max-time 15 --proto '=https')

echo "== 1. DNS and TLS =="
if [ -n "$(dig +short A "$DOMAIN"; dig +short AAAA "$DOMAIN"; dig +short CNAME "$DOMAIN")" ]; then ok "$DOMAIN resolves"; else bad "$DOMAIN does not resolve"; fi
if [ -n "$(dig +short CNAME "www.$DOMAIN"; dig +short A "www.$DOMAIN")" ]; then ok "www.$DOMAIN resolves"; else warn "www.$DOMAIN does not resolve"; fi
hdr=$("${CURL[@]}" -I "https://$DOMAIN/" 2>&1) && ok "HTTPS handshake and certificate valid" || bad "HTTPS failed: $(echo "$hdr" | tail -1)"
echo "$hdr" | grep -qi '^strict-transport-security:.*max-age=31536000' && ok "HSTS header" || bad "HSTS header missing (web/_headers not deployed?)"
echo "$hdr" | grep -qi '^x-content-type-options: *nosniff' && ok "nosniff header" || bad "nosniff header missing"
echo "$hdr" | grep -qi '^content-security-policy:' && ok "CSP header" || bad "CSP header missing"

echo "== 2. Legal pages required by the stores =="
for page in privacy.html terms.html kvkk.html community-guidelines.html support.html delete-account.html; do
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "https://$DOMAIN/$page")
  [ "$code" = "200" ] && ok "/$page -> 200" || bad "/$page -> $code"
done
cfg=$("${CURL[@]}" -I "https://$DOMAIN/config.js" | tr -d '\r')
echo "$cfg" | grep -qi '^cache-control:.*no-store' && ok "/config.js is no-store" || bad "/config.js is cacheable or missing"
webcfg=$("${CURL[@]}" "https://$DOMAIN/config.js")
echo "$webcfg" | grep -Eqi 'YOUR_|REPLACE_|example\.com' && bad "/config.js still contains a placeholder" || ok "/config.js has no placeholder"
echo "$webcfg" | grep -Eq '"deletionRequestEndpoint": "https://[^"]+"' && ok "/config.js has the account-deletion endpoint" || bad "/config.js deletionRequestEndpoint is empty (build env TAILMANCE_WEB_DELETION_ENDPOINT not set)"
echo "$webcfg" | grep -Eq '"turnstileSiteKey": "[A-Za-z0-9_-]{10,200}"' && ok "/config.js has the Turnstile site key" || bad "/config.js turnstileSiteKey is empty"

echo "== 3. Apple App Site Association =="
aasa_h=$("${CURL[@]}" -I "https://$DOMAIN/.well-known/apple-app-site-association" | tr -d '\r')
echo "$aasa_h" | head -1 | grep -q ' 200' && ok "AASA -> 200 (no redirect)" || bad "AASA did not answer 200 directly: $(echo "$aasa_h" | head -1)"
echo "$aasa_h" | grep -qi '^content-type: *application/json' && ok "AASA content-type application/json" || bad "AASA content-type is not application/json"
aasa=$("${CURL[@]}" "https://$DOMAIN/.well-known/apple-app-site-association")
echo "$aasa" | grep -Eq "\"[A-Z0-9]{10}\.$BUNDLE\"" && ok "AASA contains <TeamID>.$BUNDLE" || bad "AASA does not contain a 10-character Team ID plus $BUNDLE"
for p in '/pet/\*' '/reel/\*' '/story/\*'; do echo "$aasa" | grep -q "\"$p\"" && ok "AASA path $p" || bad "AASA path $p missing"; done
"${CURL[@]}" "https://app-site-association.cdn-apple.com/a/v1/$DOMAIN" | grep -q "$BUNDLE" && ok "Apple CDN has the file" || warn "Apple CDN has not cached it yet (can take hours after first publish)"

echo "== 4. Android Digital Asset Links =="
dal_h=$("${CURL[@]}" -I "https://$DOMAIN/.well-known/assetlinks.json" | tr -d '\r')
echo "$dal_h" | head -1 | grep -q ' 200' && ok "assetlinks.json -> 200 (no redirect)" || bad "assetlinks.json did not answer 200 directly"
echo "$dal_h" | grep -qi '^content-type: *application/json' && ok "assetlinks content-type application/json" || bad "assetlinks content-type is not application/json"
dal=$("${CURL[@]}" "https://$DOMAIN/.well-known/assetlinks.json")
echo "$dal" | grep -q "\"$BUNDLE\"" && ok "assetlinks contains $BUNDLE" || bad "assetlinks does not contain $BUNDLE"
echo "$dal" | grep -Eq '([A-F0-9]{2}:){31}[A-F0-9]{2}' && ok "assetlinks has a SHA-256 certificate fingerprint" || bad "assetlinks has no SHA-256 fingerprint"
"${CURL[@]}" "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://$DOMAIN&relation=delegate_permission/common.handle_all_urls" | grep -q "$BUNDLE" && ok "Google Digital Asset Links API confirms" || warn "Google Digital Asset Links API does not list the app yet"

echo "== 5. E-mail reputation =="
spf=$(dig +short TXT "$DOMAIN" | grep -i 'v=spf1')
[ -n "$spf" ] && ok "SPF: $spf" || bad "SPF record missing"
[ "$(echo "$spf" | grep -o 'v=spf1' | wc -l)" -le 1 ] || bad "More than one SPF record (invalid)"
dmarc=$(dig +short TXT "_dmarc.$DOMAIN" | grep -i 'v=DMARC1')
if [ -z "$dmarc" ]; then bad "DMARC record missing"
else ok "DMARC: $dmarc"; echo "$dmarc" | grep -qi 'p=none' && warn "DMARC is in monitoring mode (p=none); tighten to quarantine, then reject, once reports are clean"; fi
if [ -n "$DKIM_SELECTOR" ]; then [ -n "$(dig +short TXT "$DKIM_SELECTOR._domainkey.$DOMAIN")" ] && ok "DKIM selector $DKIM_SELECTOR" || bad "DKIM selector $DKIM_SELECTOR missing"
else warn "DKIM not checked (pass the selector of your sending provider as the second argument)"; fi
[ -n "$(dig +short MX "$DOMAIN")" ] && ok "MX present (support inbox can receive mail)" || warn "No MX record"

echo; echo "Result: $FAIL failed, $WARN warnings"
[ "$FAIL" -eq 0 ]
