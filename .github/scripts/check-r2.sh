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

# Without this, `set -u` aborts with a bare "unbound variable" and the script
# reports nothing, which is the opposite of its job.
for v in CF_ACCOUNT CF_TOKEN; do
  if [ -z "${!v:-}" ]; then
    say "- **\`$v\` is not set on this run.** Add it to the starter-templates environment."
    exit 1
  fi
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Account-owned tokens are rejected by /user/tokens/verify with code 1000 even
# when perfectly valid, so try the account endpoint too before calling it bad.
verify=$(curl -sS --connect-timeout 10 --max-time 30 "$API/accounts/$CF_ACCOUNT/tokens/verify" -H "Authorization: Bearer $CF_TOKEN")
kind="account-owned"
if ! jq -e '.success == true' <<<"$verify" >/dev/null 2>&1; then
  verify=$(curl -sS --connect-timeout 10 --max-time 30 "$API/user/tokens/verify" -H "Authorization: Bearer $CF_TOKEN")
  kind="user"
fi
if ! jq -e '.success == true' <<<"$verify" >/dev/null 2>&1; then
  say "- **Token is not valid on either the account or user endpoint.**"
  say "  \`$(jq -r '.errors[0].message // "unknown"' <<<"$verify")\`"
  exit 1
fi
say "- Token is valid and active ($kind)"

buckets_code=$(curl -sS --connect-timeout 10 --max-time 30 -o "$TMP/buckets.json" -w '%{http_code}' \
  "$API/accounts/$CF_ACCOUNT/r2/buckets" -H "Authorization: Bearer $CF_TOKEN")
if [ "$buckets_code" = "200" ]; then
  if jq -e --arg b "$BUCKET" '.result.buckets[]? | select(.name==$b)' "$TMP/buckets.json" >/dev/null; then
    say "- Sees \`$BUCKET\` in this account"
  else
    say "- **\`$BUCKET\` is NOT in this Cloudflare account.**"
    say "- Buckets it can see: \`$(jq -r '[.result.buckets[]?.name] | join(", ")' "$TMP/buckets.json")\`"
    say "- Ask for: a token on the account that owns \`$BUCKET\`."
    exit 1
  fi
else
  say "- Cannot list buckets (HTTP $buckets_code) - no R2 read scope on this account"
  say "  \`$(jq -c '.errors' "$TMP/buckets.json" 2>/dev/null || cat "$TMP/buckets.json")\`"
fi

read_code=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' \
  "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$PUBLISHED" \
  -H "Authorization: Bearer $CF_TOKEN")
say "- Read the published file: HTTP $read_code"

echo '{"check":true}' > "$TMP/check.json"
write_code=$(curl -sS --connect-timeout 10 --max-time 30 -o "$TMP/write.json" -w '%{http_code}' -X PUT \
  "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$KEY" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" --data-binary @"$TMP/check.json")
say "- Write a throwaway object: HTTP $write_code"

if [ "$write_code" = "200" ]; then
  curl -sS --connect-timeout 10 --max-time 30 -X DELETE "$API/accounts/$CF_ACCOUNT/r2/buckets/$BUCKET/objects/$KEY" \
    -H "Authorization: Bearer $CF_TOKEN" >/dev/null
  say "- Cleaned up. **R2 is ready to publish.**"
  exit 0
fi

say "- Refused: \`$(jq -r '.errors[0].message // "unknown"' "$TMP/write.json")\`"
if [ "$read_code" = "200" ]; then
  say "- Reads work but writes do not, so the token is read-only."
else
  say "- Neither read nor write is permitted on this bucket."
fi
say "- **Ask for: an R2 API token with Object Read & Write on \`$BUCKET\`.**"
exit 1
