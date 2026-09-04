---
name: starter-templates
description: Change which starter templates the desktop install picker offers. Use when someone wants to swap, add, feature or refresh a starter template, or asks what the picker shows after install.
argument-hint: '[what you want to change]'
allowed-tools: Bash(node scripts/starter-templates.mjs *) Bash(git checkout *) Bash(git switch *) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(gh pr create *) Read
---

# Starter templates

Change the starter templates the desktop installer offers, then open a PR.

The picker shows 4 templates in each of 4 tabs: `video`, `image`, `3d`, `audio`.
The list is `assets/starter-templates.json`, which desktop reads from R2 at boot,
so a merged change reaches users on their next launch with no app release.

## Rules

**Never edit the JSON directly.** Every command below regenerates the display
fields from the live template index. Hand-editing puts stale titles and sizes in
front of users and fails CI.

**Only ever pass template ids.** Titles, descriptions, sizes and thumbnails are
derived. If the user supplies them, ignore them and let the script fill them in.

**Confirm the id before writing.** Run `list` first and show the user the
matching titles. Ids differ by one character (`video_minimax_h3_t2v` vs
`..._i2v`), so never infer one from a product name.

**Never work around a rejection.** Read the message, fix the input, and tell the
user what was wrong. Do not edit the JSON to get past it.

## Steps

### 1. Find the id

```bash
node scripts/starter-templates.mjs list --modality video --free
```

`--modality` is `video`, `image`, `3d` or `audio`. `--free` or `--paid` narrows
it. Report the handful of relevant matches with titles and sizes, then confirm.

### 2. Make the change

Pick the command from what the user is changing.

Swap the featured (auto-selected) pick:

```bash
node scripts/starter-templates.mjs set --modality video --id <id> --recommended
```

Swap the paid API-node pick:

```bash
node scripts/starter-templates.mjs set --modality video --id <id> --paid
```

Swap one specific card, leaving the others alone:

```bash
node scripts/starter-templates.mjs set --modality video --id <new_id> --replaces <old_id>
```

Rebuild every tab at once, for a seasonal refresh. Four ids per tab, `*` marks
the featured card, `$` marks the paid one. Single-quote each list so the shell
leaves `$` alone:

```bash
node scripts/starter-templates.mjs replace \
  --video '*id_a,$api_id,id_c,id_d' \
  --image '*id_a,$api_id,id_c,id_d' \
  --3d '*id_a,$api_id,id_c,id_d' \
  --audio '*id_a,$api_id,id_c,id_d'
```

Refresh titles and sizes for the ids already in the list, changing nothing else:

```bash
node scripts/starter-templates.mjs regenerate
```

Each tab holds 4 slots, so `set` replaces rather than appends. The script
validates before writing, so a refusal leaves the file untouched.

The spec pins the slot rule, not the exact order: every tab keeps its
recommended pick in slot 1 and its paid card in slot 2, while slots 3 and 4
may reorder freely. So a plain swap of the two free cards needs no spec
change. The `TABS` fixture in `scripts/starter-templates.spec.mjs` only feeds
the negative `replace` cases — its own order is never compared against the
file — so leave it alone unless you add or drop an id there.

### 3. Open a PR

```bash
git switch -c templates/<short-description>
git add assets/starter-templates.json
git commit -m "content(templates): <what changed and why>"
git push -u origin HEAD
gh pr create --title "content(templates): <what changed>" --body "<what and why>"
```

Name the old and new template in the PR body, and why it changed. A swap,
feature or paid change touches only `assets/starter-templates.json`. Add
`scripts/starter-templates.spec.mjs` to the commit only if you introduced or
removed an id that the `TABS` fixture references. Nothing else should change;
if `git status` shows more, you edited the JSON by hand instead of running the
script.

### 4. Report back

Tell the user which template replaced which, and that it reaches users on their
next app launch once the PR merges. Nothing ships before then.

## What the script refuses

These fail silently in the app, so they fail here instead.

- Exactly 4 templates per tab.
- Exactly 1 featured per tab, and it must be free.
- Exactly 1 paid (API-node) template per tab.
- Every id must exist in the live template index.
- No duplicate ids anywhere, including across tabs.
- Ids and text within the app's length caps.

## If something fails

`is not in the template index` — the id is wrong or was renamed upstream. Run
`list` for that modality and pick from the output.

`cannot be both --recommended and paid` — the featured card must be free. Ask
which the user meant.

`needs exactly 1 paid template` — a tab lost or gained its API-node card. Use
`--replaces` to swap like for like.

`could not read the template index` — the live index is unreachable. This is
network, not input. Retry rather than changing the request.

First run in a fresh clone: see [setup.md](setup.md). Needs Node 22 and
`gh auth login`, no build step.
