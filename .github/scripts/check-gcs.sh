#!/usr/bin/env bash
# Reports what the mirror service account can do. Uses the JSON API with the
# token `google-github-actions/auth` exports, rather than the gcloud CLI.
set -uo pipefail

BUCKET=comfy-desktop-public
PREFIX=standalone-environments
KEY="$PREFIX/.credential-check-${GITHUB_RUN_ID:-local}.json"

say() {
  echo "$1"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

say "### GCS mirror"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

CREDS="${GOOGLE_APPLICATION_CREDENTIALS:-}"
if [ -z "$CREDS" ] || [ ! -f "$CREDS" ]; then
  say "- **No credentials were exported by the auth step.**"
  exit 1
fi
say "- Service account: \`$(jq -r '.client_email // "unknown"' "$CREDS")\`"
say "- Project: \`$(jq -r '.project_id // "unknown"' "$CREDS")\`"

# Mint an access token from the service-account key.
TOKEN=$(python3 - "$CREDS" <<'PY'
import base64, json, sys, time, urllib.parse, urllib.request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

key = json.load(open(sys.argv[1]))
b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b'=')
now = int(time.time())
claim = {
    "iss": key["client_email"],
    "scope": "https://www.googleapis.com/auth/devstorage.read_write",
    "aud": key["token_uri"],
    "iat": now,
    "exp": now + 300,
}
signing_input = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()) + b"." + b64(json.dumps(claim).encode())
signature = serialization.load_pem_private_key(key["private_key"].encode(), password=None).sign(
    signing_input, padding.PKCS1v15(), hashes.SHA256()
)
assertion = (signing_input + b"." + b64(signature)).decode()
body = urllib.parse.urlencode({
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "assertion": assertion,
}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request(key["token_uri"], data=body), timeout=30) as r:
        print(json.load(r)["access_token"])
except Exception as e:
    print("", end="")
    sys.stderr.write(f"token exchange failed: {e}\n")
PY
)

if [ -z "$TOKEN" ]; then
  say "- **Could not mint an access token from the key.** It may be disabled or malformed."
  exit 1
fi
say "- Minted an access token"

read_code=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' \
  "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/$(printf %s "$PREFIX/starter-templates.json" | jq -sRr @uri)" \
  -H "Authorization: Bearer $TOKEN")
say "- Read the published file: HTTP $read_code (404 just means it is not there yet)"

echo '{"check":true}' > "$TMP/check.json"
write_code=$(curl -sS --connect-timeout 10 --max-time 30 -o "$TMP/gcs-write.json" -w '%{http_code}' -X POST \
  "https://storage.googleapis.com/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$(printf %s "$KEY" | jq -sRr @uri)" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @"$TMP/check.json")
say "- Write a throwaway object: HTTP $write_code"

if [ "$write_code" = "200" ]; then
  # Publishing overwrites an existing object, which a create-only credential
  # cannot do, so prove overwrite rather than just create.
  again=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' -X POST \
    "https://storage.googleapis.com/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$(printf %s "$KEY" | jq -sRr @uri)" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data-binary @"$TMP/check.json")
  say "- Overwrite the same object: HTTP $again"

  del=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' -X DELETE \
    "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/$(printf %s "$KEY" | jq -sRr @uri)" \
    -H "Authorization: Bearer $TOKEN")
  say "- Delete the throwaway object: HTTP $del"

  if [ "$again" != "200" ]; then
    say "- **Create works but overwrite does not, so publishing would fail.**"
    say "- Ask for: Storage Object Admin on \`$BUCKET\`, not just object create."
    exit 1
  fi
  if [ "$del" != "204" ] && [ "$del" != "200" ]; then
    say "- Left \`$KEY\` behind; the credential cannot delete."
  fi
  say "- **Mirror is ready to publish.**"
  exit 0
fi

say "- Refused: \`$(jq -c '.error.message' "$TMP/gcs-write.json" 2>/dev/null || cat "$TMP/gcs-write.json")\`"
say "- **Ask for: Storage Object Admin on \`$BUCKET\` for this service account.**"
exit 1
