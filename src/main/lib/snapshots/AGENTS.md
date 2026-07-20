# Snapshots — what a snapshot *is*

Read this before changing anything in this directory.

## A snapshot is a record of a state the install has ACTUALLY been in

A snapshot is **not** an arbitrary `.json` config file. Each committed snapshot in
`.launcher/snapshots` is a faithful record of the ComfyUI install's real state
(ComfyUI commit, custom nodes, pip packages, channel, python version) at a moment
the install genuinely lived in that state, captured so the state can be
reconstructed later.

Two invariants follow from this, and every change here must preserve them:

1. **Committed history only contains states the install has actually been in.**
   Never write a snapshot to history to represent a state that was merely
   *desired* or *attempted*.
2. **The newest (top / "Latest") snapshot must reflect the current live state.**
   The history is a timeline; its head is what the install looks like right now.

## The #1137 bug, and why "just snapshot after failure" is the WRONG fix

Bug: importing a snapshot and restoring it can **fail and roll back** (e.g. the
imported snapshot's dependencies can't be installed). The error correctly reports
the rollback, but the imported snapshot — the state we *tried* to apply — was
showing as **"Latest"**, making the user think the failed attempt is the current
state. The environment was actually rolled back to the previous state.

The tempting-but-wrong fix is "after a failed restore, write a new snapshot of
the current state on top." That treats the symptom: it fabricates an extra
history entry to paper over the fact that a never-applied target was committed in
the first place. (It also only reliably self-heals on next boot, when the app
notices the discrepancy and captures a boot snapshot — we must not depend on
that to fix a perfectly knowable apply failure.)

The correct fix is structural: **an imported snapshot is a restore *target*, not
history, until the restore succeeds.**

## How import + restore works (Strategy B: stage, then commit on success)

- `importSnapshots()` commits an envelope into live history. It MUST only be
  called once the snapshots it contains represent a state the install has
  actually been in — i.e. **after a restore from the envelope has succeeded.**
- To make an imported envelope available as a restore target without polluting
  history, **stage** it with `stageSnapshotEnvelope()` (temp file keyed by an
  opaque token), load it back with `loadStagedSnapshotEnvelope(token)`, and drop
  it with `releaseStagedSnapshotEnvelope(token)`.
- The import-confirm IPC handler stages the envelope and returns a
  `restoreToken` (never a history filename). The `snapshot-restore` action
  accepts either an in-history `file` or a staged `restoreToken`.
- **On successful restore:** commit the staged envelope via `importSnapshots()`,
  then save a `post-restore` snapshot of the true resolved current state (so the
  top reflects reality even if versions/nodes differ from the target), then
  release the staged token.
- **On failed / cancelled restore:** do **nothing** to history. The previous
  in-history snapshot already represents the rolled-back current state and stays
  on top. The staged token is left in place (it self-prunes after a day) so a
  retry can reuse it.

The same staging discipline applies to `standaloneMigration.ts`
(legacy-desktop → standalone migration): validate the envelope as a target,
restore, and only `importSnapshots()` on success.

## `ensureCurrentSnapshotOnTop` is a narrow repair, not the fix

`ensureCurrentSnapshotOnTop` (in `store.ts`) exists only as a safety net for
genuine edge cases where the on-disk state is novel and no existing snapshot
matches it — e.g. an install with no prior snapshot, or a partial restore with
no source rollback (fresh-install migration). After a normal failed restore it is
a no-op. **Do not** reintroduce it as the primary mechanism for keeping the top
accurate after a failed import-restore; staging is the mechanism.
