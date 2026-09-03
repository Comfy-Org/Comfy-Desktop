#!/usr/bin/env bash
# Reports what the R2 token can do against the bucket the workflow publishes to.
# Separates "token invalid" from "cannot see the bucket" from "read but not
# write", so a failure names the permission to ask for.
set -uo pipefail

API=https://api.cloudflare.com/client/v4
BUCKET=desktop-assets
PUBLISHED=standalone-environments/starter-templates.json
KEY="standalone-environments/.credential-check-${GITHUB_RUN_ID:-local}.json"

say() {
  echo "$1"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

say "### R2"

# Account-owned tokens are rejected by /user/tokens/verify with code 1000 even
# when perfectly valid, so try the account endpoint too before calling it bad.
verify=$(curl -sS "$API/accounts/$CF_ACCOUNT/tokens/verify" -H "Authorization: Bearer $CF_TOKEN")
kind="account-owned"
if ! grep -q '"success":true' <<<"$verify"; then
  verify=$(curl -sS "$API/user/tokens/verify" -H "Authorization: Bearer $CF_TOKEN")
  kind="user"
fi
if ! grep -q '"success":true' <<<"$verify"; then
  say "- **Token is not valid on either the account or user endpoint.**"
  say "  \`$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' <<<"$verify" | head -1)\`"
  exit 1
fi
say "- Token is valid and active ($kind)"

buckets_code=$(curl -sS -o /tmp/buckets.json -w '%{http_code}' \
  "$API/accounts/$CF_ACCOUNT/r2/buckets" -H "Authorization: Bearer $CF_TOKEN")
if [ "$buckets_code" = "200" ]; then
  if jq -e --arg b "$BUCKET" '.result.buckets[]? | select(.name==$b)' /tmp/buckets.json >/dev/null; then
    say "- Sees \`$BUCKET\` in this account"
  else
    say "- **\`$BUCKET\` is NOT in this Cloudflare account.**"
    say "- Buckets it can see: \`$(jq -r '[.result.buckets[]?.name] | join(", ")' /tmp/buckets.json)\`"
    say "- Ask for: a token on the account that owns \`$BUCKET\`."
    exit 1
  fi
else
  say "- Cannot list buckets (HTTP $buckets_code) - no R2 read scope on this account"
  say "  \`$(jq -c '.errors' /tmp/buckets.json 2>/dev/null || cat /tmp/buckets.json)\`"
fi

read_code=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$PUBLISHED" \
  -H "Authorization: Bearer $CF_TOKEN")
say "- Read the published file: HTTP $read_code"

echo '{"check":true}' > /tmp/check.json
write_code=$(curl -sS -o /tmp/write.json -w '%{http_code}' -X PUT \
  "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$KEY" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" --data-binary @/tmp/check.json)
say "- Write a throwaway object: HTTP $write_code"

if [ "$write_code" = "200" ]; then
  curl -sS -X DELETE "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$KEY" \
    -H "Authorization: Bearer $CF_TOKEN" >/dev/null
  say "- Cleaned up. **R2 is ready to publish.**"
  exit 0
fi

say "- Refused: \`$(jq -c '.errors' /tmp/write.json 2>/dev/null || cat /tmp/write.json)\`"
if [ "$read_code" = "200" ]; then
  say "- Reads work but writes do not, so the token is read-only."
else
  say "- Neither read nor write is permitted on this bucket."
fi
say "- **Ask for: an R2 API token with Object Read & Write on \`$BUCKET\`.**"
exit 1
