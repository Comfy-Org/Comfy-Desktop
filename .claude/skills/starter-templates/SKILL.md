---
name: starter-templates
description: Change which starter templates the desktop install picker offers. Use when someone wants to swap, add, feature or refresh a starter template, or asks what the picker shows after install.
argument-hint: '[what you want to change]'
allowed-tools: Bash(node scripts/starter-templates.mjs *) Bash(git checkout *) Bash(git switch *) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(gh pr create *) Read
---

## Changing the starter templates

First time here? See [setup.md](setup.md) — Node 22 and `gh auth login`, nothing else.

The picker shows 4 templates in each of 4 tabs (video, image, 3d, audio). The
list lives in `assets/starter-templates.json`, which desktop reads from R2 at
boot, so a merged change reaches users on their next launch with no app release.

**Only ever supply template ids.** Titles, descriptions, download sizes and
thumbnails are refreshed from the live template index whenever `set`, `replace`
or `regenerate` runs, so they are never typed by hand. If upstream retitles a
template already in the list, `regenerate` picks it up. Never hand-edit the JSON.

### 1. Find the template id

```bash
node scripts/starter-templates.mjs list --modality video --free
```

`--modality` is one of `video`, `image`, `3d`, `audio`. Add `--free` or `--paid`
to narrow. Show the user a few relevant matches with their titles and sizes, and
confirm which one they mean before changing anything.

### 2. Make the change

Swap the recommended (auto-selected) pick:

```bash
node scripts/starter-templates.mjs set --modality video --id <template_id> --recommended
```

Swap the paid API-node pick:

```bash
node scripts/starter-templates.mjs set --modality video --id <template_id> --paid
```

Swap a specific card:

```bash
node scripts/starter-templates.mjs set --modality video --id <new_id> --replaces <old_id>
```

Each tab keeps 4 slots, so a `set` replaces rather than appends. The script
validates before writing and refuses anything that would break the picker.

### Rebuild the whole list

For a seasonal refresh rather than a one-slot swap. Four ids per tab, `*` marks
the auto-pick, `$` marks the paid card. Use single quotes so the shell leaves
`$` alone.

```bash
node scripts/starter-templates.mjs replace \
  --video '*id_a,$api_id,id_c,id_d' \
  --image '*id_a,$api_id,id_c,id_d' \
  --3d '*id_a,$api_id,id_c,id_d' \
  --audio '*id_a,$api_id,id_c,id_d'
```

### 3. Refresh stale metadata

When upstream retitles or resizes a template already in the list:

```bash
node scripts/starter-templates.mjs regenerate
```

Same ids, refreshed display fields.

### 4. Open a PR

```bash
git switch -c templates/<short-description>
git add assets/starter-templates.json
git commit -m "content(templates): <what changed and why>"
git push -u origin HEAD
gh pr create --title "content(templates): <what changed>" --body "<what and why>"
```

Say in the PR body which template was swapped for which, and why. CI re-runs
validation, so a broken list cannot merge.

## Rules the script enforces

These are not style preferences. A violation is silent in the app: a short tab
quietly backfills, and a paid auto-pick spends the user's credits on first run.

- Exactly 4 templates per tab.
- Exactly 1 recommended per tab, and it must be free.
- At most 1 paid (API-node) template per tab. This is an open-source
  distribution requirement, not a preference.
- Every id must exist in the live template index.
- No duplicate ids anywhere.

If the script rejects a change, read the message and fix the input. Never edit
the JSON by hand to get around it.

## What to tell the user

After opening the PR, tell them the change reaches users on their next app
launch once it merges, and that nothing ships until then.
