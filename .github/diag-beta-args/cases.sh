#!/usr/bin/env bash
# Temporary diagnostics for the beta-args reopen PR. Not for merge.
set -u
job="$1"
commit=e2e/core-beta-args-pill-commit.test.ts
stopped=e2e/core-beta-args-pill-stopped.test.ts
restart=e2e/core-beta-args-pill-restart.test.ts
pill=e2e/core-beta-args-pill.test.ts
NEXT_OPEN='turning the beta opt-in off'
HIDDEN='an opt-in change made while the picker is hidden'
BELOW='moving HEAD below the range'
OBJECTS='an object store git cannot read'
UNPREDICTABLE='whose next launch cannot be predicted'
MESSAGES="(the pill was shown on the next open after the beta opt-in was turned off|the pill survived an opt-out made while the picker was hidden|the pill still showed the previous session's grant after the restart|a pill was shown for a next launch that cannot be predicted|the grant was still shown with HEAD below its range|the grant was shown though git could not prove it|this open never had both asks answered|a later ask arrived after the open settled|the overridden grant was still shown after the args were committed)"

echo "### $job" >> "$GITHUB_STEP_SUMMARY"
echo '| Case | Expected | Exit | Playwright counts | Failure messages (unique per failed test) |' >> "$GITHUB_STEP_SUMMARY"
echo '| --- | --- | --- | --- | --- |' >> "$GITHUB_STEP_SUMMARY"

run() {
  local label="$1" want="$2"; shift 2
  local log="logs/$(echo "$label" | tr -c 'A-Za-z0-9\n' '-').log"
  xvfb-run --auto-servernum pnpm exec playwright test --project=linux --retries=0 --reporter=list "$@" > "$log" 2>&1
  local code=$?
  local counts msgs
  counts=$(grep -E '^\s+[0-9]+ (passed|failed|flaky|skipped|did not run|interrupted)' "$log" | xargs)
  msgs=$(grep -E '^\s+Error: ' "$log" | grep -oE "$MESSAGES" | sort | uniq -c | xargs)
  echo "| $label | $want | $code | $counts | ${msgs:-none} |" | tee -a logs/table.md >> "$GITHUB_STEP_SUMMARY"
  echo "== $label (want $want, exit $code): $counts | ${msgs:-no known message}"
  grep -E '^\s+[0-9]+\) \[linux\]|^\s+Error: |^\s+(Expected|Received)' "$log" | sed 's/^/    /' | head -40
}

mkdir -p logs
echo "Playwright: $(pnpm exec playwright --version)" | tee -a "$GITHUB_STEP_SUMMARY"
case "$job" in
  as-ci|loaded)
    n=20; r=8
    if [ "$job" = loaded ]; then n=15; r=5; fi
    run "commit+stopped+pill x$n" pass "$commit" "$stopped" "$pill" --repeat-each=$n
    run "restart x$r" pass "$restart" --repeat-each=$r
    ;;
  mutant-optout)
    run "after: stopped next open x3" fail "$stopped" --grep "$NEXT_OPEN" --repeat-each=3
    run "after: stopped hidden picker x3" fail "$stopped" --grep "$HIDDEN" --repeat-each=3
    ;;
  mutant-always-grant|mutant-always-grant-slow)
    run "after: commit HEAD below x2" fail "$commit" --grep "$BELOW" --repeat-each=2
    run "after: commit object store x2" fail "$commit" --grep "$OBJECTS" --repeat-each=2
    run "after: stopped next open x2" fail "$stopped" --grep "$NEXT_OPEN" --repeat-each=2
    run "after: stopped hidden picker x2" fail "$stopped" --grep "$HIDDEN" --repeat-each=2
    run "after: restart x2" fail "$restart" --repeat-each=2
    run "after: unpredictable next launch x2" fail "$pill" --grep "$UNPREDICTABLE" --repeat-each=2
    ;;
esac
echo; cat logs/table.md
exit 0
