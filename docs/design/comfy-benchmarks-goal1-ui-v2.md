# Comfy Benchmarks — Goal 1, UI cleanup (v2)

KISS redesign of the Benchmarks (performance-test) screen. This is a **template +
styles** pass over `src/renderer/src/views/PerformanceTestView.vue`. Every `ref`,
`computed`, IPC call, and handler in the existing `<script setup>` stays. No new
route, no new store, **zero new components**.

- **Owner:** designer
- **Supersedes (layout only):** `docs/design/comfy-benchmarks-goal1.md` §3 (the
  three-column layout map). §2 data model, §5 states, §6 result semantics, §7 copy
  deck all carry forward unchanged — v2 only re-arranges them.
- **Persona:** VFX artist (5–25 yr). Wants one honest number without reading a form.
  Secondary: power user who needs BYO workflow + warm-up/measured counts + raw logs
  (kept, but quiet).

---

## 0. Why v2 (the three problems, restated)

| Problem in v1                                           | Cause                                                     | v2 fix                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Weak primary-action hierarchy; `Run` buried in column 3 | 3 side-by-side columns (instance \| picker \| settings)   | Single vertical flow; one full-width primary CTA at the bottom of the setup block                      |
| Measurement settings shout as loud as the core choice   | warm-up/measured given a full equal-weight column         | Collapsed behind an `Advanced` disclosure with the current values shown in the label                   |
| ~650 lines of scoped CSS                                | bespoke 3-col grid, selection rows, dual run/stop buttons | Collapse to a linear stack; delete the grid + selection-row CSS; single state-swapping button (see §9) |

**One-line intent:** the screen reads top-to-bottom as one sentence — _"Run [this
benchmark] on [this machine] → [Run]"_ — then the result lands below it.

---

## 1. Layout — single vertical flow (desktop)

```
┌───────────────────────────────────────────────────────────────── (account chip) ┐
│  [logo]  Benchmarks                                                                │
│          Measure how your machine runs a real workflow.                           │
│                                                                                    │
│  Run on   [ Workspace ▾ ]   [ Instance ▾ ]                     ← contextual bar    │
│                                                                                    │
│  ┌ Standard benchmark ┐┌ My workflow ┐                         ← source toggle     │
│  └────────────────────┘└─────────────┘                                            │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ Z-Image Turbo · 1024 Text-to-Image                          Downloaded ✓  │   │  ← choice
│  │ The default get-started pipeline most machines run first                   │   │    (ChoiceCard,
│  │ 1024px · 4 steps · res_multistep          [16 GB tier]  Fits your VRAM     │   │     full width)
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
│  ▸ Advanced   ·   Warm-up 1, Measured 5                        ← collapsed         │
│                                                                                    │
│                                                    [   Run benchmark ▶   ]         │  ← single primary CTA
│  ────────────────────────────────────────────────────────────────────────────    │
│  Results                                                                           │  ← payoff (§5–§6)
│      Run a benchmark to see throughput and memory for this machine.               │
│                                                                                    │
│  ▸ Logs                                                        ← quiet escape hatch│
└────────────────────────────────────────────────────────────────────────────────┘
```

### Region table

| #   | Region        | Content                                                                | Weight                    | DS / element                                                   |
| --- | ------------- | ---------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| A   | Header        | wordmark + title + one-line description; account chip pinned top-right | brand                     | `BrandedPageHeader`, `DevPlatformAccountChip`                  |
| B   | Context bar   | `Run on` label + Workspace selector + Instance selector, **one row**   | contextual (muted, small) | `DevPlatformWorkspaceSelector`, `BaseSelect`                   |
| C   | Source toggle | `Standard benchmark` / `My workflow` segmented control                 | secondary                 | existing segmented control (kept, ~25 lines CSS)               |
| D   | Choice        | Standard: benchmark card(s). Custom: drop-zone                         | **primary**               | `ChoiceCard` (standard) / drop-zone (custom)                   |
| E   | Advanced      | disclosure; collapsed by default; warm-up + measured inputs inside     | secondary (collapsed)     | `CollapsibleSectionToggle` + two `brand-input`s                |
| F   | Primary CTA   | one button: `Run benchmark` ↔ `Stop` by state                          | **primary**               | `button.brand-primary` / `button.danger-solid`                 |
| G   | Results       | idle hint → progress → headline + detail                               | payoff                    | `CollapsibleSectionToggle` (expanded) + existing result markup |
| H   | Logs          | raw session output                                                     | escape hatch (collapsed)  | `CollapsibleSectionToggle` (collapsed default)                 |

**Stack order rationale:** context (B) sits above the choice because "where" frames
"what," but it is visually quiet (one muted row, auto-resolved for most users).
The choice (D) is the visual anchor. Advanced (E) and the CTA (F) sit directly
under the choice so the eye finishes the setup and hits Run without scanning
sideways. Results (G) is the reward, full-width, directly below.

### Narrow-width behavior (window resizes)

- **Min sensible width ≈ 480px.** The window is a desktop app frame; no phone layout.
- Context bar (B): selectors wrap to their own lines below the `Run on` label under ~560px.
- Result headline band (G, §6): its two stat cells go `2 col → 1 col` under ~640px (existing `grid-template-columns: repeat(2, …)` → single column via one `@media` query — the only media query v2 keeps).
- Cards (D) are always a single full-width column, so they never need a breakpoint.

---

## 2. Information hierarchy

| Tier             | Elements                                   | Treatment                                                                                                                                 |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary**      | benchmark choice (D) + Run button (F)      | Largest surface; card is full-width; CTA is the only yellow `brand-primary` on screen                                                     |
| **Secondary**    | source toggle (C), Advanced disclosure (E) | Small controls; Advanced collapsed, values echoed in its label so nothing is hidden that a user needs to _see_ (only hidden from _touch_) |
| **Contextual**   | workspace + instance (B)                   | Muted one-row bar; auto-selected first eligible instance (logic already does this); user rarely touches it                                |
| **Escape hatch** | Logs (H)                                   | Collapsed by default; power-user surface, per "escape hatches are quiet"                                                                  |

Advanced label always shows live values, e.g. `▸ Advanced · Warm-up 1, Measured 5`
(bind to `warmupRuns` / `measuredRuns`). Expanding reveals the two number inputs
plus one muted helper line: _"Warm-up runs prime caches and are discarded. Measured
runs are averaged into the result."_

---

## 3. Standard vs custom — toggle + scaling

**Toggle placement:** region C, left-aligned, directly under the context bar and
above the choice area. Default `Standard benchmark`. `role="radiogroup"`, arrow-key
navigable (unchanged from v1). Switching to `My workflow` swaps region D's contents
to the drop-zone; switching back restores the card selection (session-remembered).

**Standard, N = 1 (today):** one `ChoiceCard`, **full width**, pre-selected on open
so Run is immediately actionable. It reads as a confident single recommendation, not
a lonely item in an empty grid.

**Standard, N > 1 (later):** same region becomes a **single-column vertical stack**
of full-width cards (not a multi-column grid). Rationale: cards are horizontal
(title left, badges right) and a vertical list stays scannable, keeps selection
obvious, and needs no responsive grid math. If the set ever grows past ~6, add a
short `Show all` affordance rather than a wall of cards — out of scope for Goal 1.

> Delete the v1 `.performance-test__benchmark-cards` `grid auto-fill minmax(240px…)`
> rule; replace with a plain `flex-direction: column; gap: 12px` stack.

**Custom (`My workflow`):** the existing drop-zone verbatim (drag/drop or click to
pick a `.json`, filename + path shown, trash to remove, inline import error). No
change beyond it now living in the single-column flow.

---

## 4. Card anatomy (standard mode) — unchanged content, cleaner frame

Reuse `ChoiceCard` with `selectable` + `selected` (border-driven selection, no radio
glyph). Slots already wired in v1:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Z-Image Turbo · 1024 Text-to-Image                          Downloaded ✓   │  label + #label-trailing (download badge)
│ The default get-started pipeline most machines run first                   │  description
│ 1024px · 4 steps · res_multistep          [16 GB tier]  Fits your VRAM     │  #desc-trailing (spec line + tier chip + fit note)
└──────────────────────────────────────────────────────────────────────────┘
```

- **Download badge** (`#label-trailing`): `Downloaded ✓` when present, else
  `~20.7 GB ⬇` (tooltip _Downloads on first run_). Logic = `modelsPresentById` (kept).
- **Tier chip + fit note** (`#desc-trailing`): `16 GB tier` chip; fit note from
  `benchmarkFit()` — `Fits your VRAM` / `May exceed your VRAM` (caution) on dedicated
  GPUs, `Recommended: 16 GB+` on Apple/CPU. All logic kept.

No card-internal layout change; it just spans full width now instead of a 240px grid cell.

---

## 5. Every state

State is driven by the existing `runPhase` (`idle|downloading|warmup|measuring|done|error`)
plus `isLaunching` / `isStopping` / instance availability. One phase renders at a time
inside region G. The primary button (F) swaps with the same state.

| State                   | Region D (choice)                     | Region F (button)                       | Region G (results body)                                                                           |
| ----------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Idle**                | interactive; card pre-selected        | `Run benchmark` (enabled when `canRun`) | Hint: _Run a benchmark to see throughput and memory for this machine._                            |
| **Empty — no instance** | choice still shows, but disabled feel | `Run benchmark` **disabled**            | Notice: _No local ComfyUI instance found. Create or install one, then come back to benchmark it._ |
| **Downloading models**  | locked                                | `Stop` (danger)                         | Download card (§5.1)                                                                              |
| **Warming up**          | locked                                | `Stop`                                  | Warm-up progress (§5.2)                                                                           |
| **Measuring**           | locked                                | `Stop`                                  | Measure progress (§5.3)                                                                           |
| **Done**                | unlocked                              | `Run benchmark`                         | Headline + detail (§6)                                                                            |
| **Error**               | unlocked                              | `Run benchmark`                         | Inline error (§5.4); Logs auto-expands                                                            |
| **Stopped (partial)**   | unlocked                              | `Run benchmark`                         | Partial result or "stopped" note (§5.5)                                                           |

### 5.1 Downloading (only when `modelsPresent === false`)

```
Downloading models for Z-Image Turbo · 1024        13.6 / 20.7 GB
[■■■■■■■■■□□□□□□□]
This happens once. Future runs skip straight to warm-up.
```

Reuse `.performance-test__progress` + `.performance-test__progress-track`. `Stop`
cancels and returns to idle. Never shown in `My workflow` mode.

### 5.2 Warm-up (not measured)

```
Warming up · run 1 of 1 (not measured)
[■■■■■■■■■■■■■■□□]
```

`(not measured)` is load-bearing honesty — the first run is always slow.

### 5.3 Measuring

```
Measuring · run 3 of 5
[■■■■■■■■■□□□□□□□]
```

Progress = measured runs completed / total (offset past warm-up). Copy from `benchmarkPhaseLabel` (kept).

### 5.4 Errors (inline, danger token, in region G)

- Launch failed → _Couldn't start the instance. See Logs for details._ + auto-expand Logs.
- OOM → _Ran out of memory on this benchmark. Free up memory and rerun._
- All runs failed → _No runs completed. See Logs for details._

### 5.5 Stopped

User `Stop` mid-measure keeps completed runs; header context line carries
_Partial (stopped after 2 of 5)_. If zero measured runs completed, show the idle
hint again (nothing to report).

---

## 6. Result presentation (region G, done state)

Carried over from v1 §6 — semantics unchanged, layout tightened into one scannable
column. Order top→bottom:

```
Z-Image Turbo · 1024 Text-to-Image · RTX 4070 (12 GB) · Sep 28, 2026 3:14 PM   ← context line (muted)

┌────────────────────────────┬────────────────────────────┐
│  2.14  s / image           │  7.8 GB  VRAM peak          │   ← headline band (2 stats)
│  median of 5 runs          │  of 12 GB · fits            │
│  ▲ 12% faster than last run│                             │
└────────────────────────────┴────────────────────────────┘
range 2.05–2.61 s · avg 2.22 s · 5 runs, 0 failed          ← trust/variance row (muted)

▾ Run durations        [fastest ▮▮▮ ] [slowest …] [avg …] [median …]   ← existing aggregate bars
▾ System information    device · memory · PyTorch · xFormers · CPU · OS  ← existing dl, backend-aware label

[ Open results folder ]   [ Export results image ]          ← existing actions
```

- **Primary stat = median sec/image** (`medianPerImageSeconds`, ~32px value). Unit
  `s / image` when `imagesPerRun` known, else `s / run`. Sub: `median of N runs`.
  Compare delta below (faster/slower/same/first/different-GPU) from `compareResult`.
- **Secondary stat = memory peak**, **backend-aware** (from `vramPeak` / `headlineTier`):
  | Tier | Headline | Second line |
  |---|---|---|
  | NVIDIA/AMD dedicated | `{peak} GB VRAM peak` | `of {total} GB · fits` / `exceeded — offloaded to RAM` |
  | Apple (MPS) | `{peak} GB memory peak` | `unified memory (shared with system RAM)` — never "fits your VRAM" |
  | CPU | `{peak} GB system RAM peak` | `of {total} GB RAM` |
  Absent peak → `VRAM peak — not measured` (muted). Never blanks.
- **Trust row** (full width, muted): `range … · avg … · N runs, F failed`; color `F` danger when `>0`.
- Below: existing `Run durations` bar chart + `System information` `<dl>` (VRAM row label follows the same backend rule) + actions row. All kept as-is.

This whole block already exists in the template; v2 keeps it and simply removes the
surrounding 3-column shell so it reads as the natural bottom of the page.

---

## 7. Component mapping (new components = 0)

| Region       | Component(s) reused                                                                                                                         | Notes                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A            | `BrandBackground`, `BrandedPageHeader`, `DevPlatformAccountChip`                                                                            | unchanged                                                                                      |
| B            | `DevPlatformWorkspaceSelector`, `BaseSelect`                                                                                                | moved into one inline row; drop the `.performance-test__selection-row` two-column label layout |
| C            | existing segmented toggle                                                                                                                   | kept; ~25 lines CSS retained                                                                   |
| D (standard) | `ChoiceCard` (`selectable`/`selected`, `#label-trailing`, `#desc-trailing`), `InfoTooltip` (optional, for tier/fit help), lucide `Download` | grid → flex column                                                                             |
| D (custom)   | existing drop-zone markup, lucide `Trash2`                                                                                                  | unchanged                                                                                      |
| E            | `CollapsibleSectionToggle` + two `brand-input` number inputs                                                                                | inputs move inside the disclosure                                                              |
| F            | `button.brand-primary` / `button.danger-solid`                                                                                              | **one** button, state-swapped                                                                  |
| G            | `CollapsibleSectionToggle` + existing headline/`<dl>`/aggregate markup, lucide `ArrowUp`/`ArrowDown`/`FolderOpen`/`ImageDown`               | expanded by default                                                                            |
| H            | `CollapsibleSectionToggle` + logs `<div>`                                                                                                   | collapsed by default (see §9)                                                                  |

Nothing genuinely new is required. If the engineer wants, the two headline stats can
stay inline (they already are) — do **not** add `BenchmarkHeadlineStat.vue`; KISS.

---

## 8. Token vocabulary (stay in the system)

Buttons: `brand-primary` (yellow CTA), `danger-solid` (Stop), `secondary` (folder/export).
Surfaces: `--chooser-surface-bg`, `--chooser-surface-border`, `--brand-surface-bg-hover`.
Text: `--text-primary`, `--text-muted`, `--text-faint`, `--neutral-100/200/300`.
Accent/progress: `--comfy-yellow`. Type scale for headline value ~32px (existing).
No new tokens. No new color. The only yellow on the screen is the Run CTA and the
progress fill.

---

## 9. CSS reduction plan (target: ~650 → ~280 lines)

**Delete** (obsoleted by the linear layout):

- `.performance-test__columns` (3-col grid) and `.performance-test__column` grid rules.
- `.performance-test__selection-row` / `.performance-test__selection-label` two-column label scaffolding (replace with one inline flex row).
- `.performance-test__run-actions` dual-button alignment (single button now).
- The `@media (max-width: 900px)` column collapse (no columns to collapse).
- `.performance-test__benchmark-cards` grid → replace with a 3-line flex column.

**Keep** (still needed): progress track, drop-zone, source toggle, headline band,
compare, aggregate chart, result `<dl>`, system groups, one `@media (max-width: 640px)`
that stacks the headline band's two cells.

**Two template-only default flips** (one-line each, no logic change; flagged, not required):

1. `logsExpanded` default `true → false` — Logs is an escape hatch, quiet by default.
2. Single Run/Stop button: render `Stop` (`danger-solid`) while `isLaunching`, else
   `Run benchmark` (`brand-primary`). Both handlers (`runPerformanceTest`,
   `stopPerformanceTestFromUser`) and both guards (`canRun`, `canStop`) already exist —
   this is purely a `v-if`/`v-else` in the template.

---

## 10. What I am NOT changing

- **The `<script setup>`** — every `ref`, `computed`, `watch`, IPC call, telemetry
  emit, and handler stays byte-for-byte. v2 is template + `<style>` only.
- **IPC / backend contract** — `ensureStandardBenchmarkModels`,
  `runPerformanceTestWorkflow`, download progress, results summary schema: untouched.
- **Result semantics** — median-as-hero, backend-aware memory labels, compare rules,
  the honest "not measured" fallbacks: all from v1 §6, unchanged.
- **The Benchmarks history / compare view** (`BenchmarksView.vue`) — separate screen,
  out of scope.
- **The export image path** (`performanceTestResultsSvg.ts`) — untouched.
- **The standard-benchmark manifest** (`standardBenchmarks.ts`) — untouched; the UI
  already scales from 1 to N via §3.

---

## 11. Open questions

1. **Single Run/Stop button vs. keeping both.** v2 recommends one state-swapping
   button (cleaner primary-action hierarchy). If QA/telemetry prefers a persistent
   `Stop` visible next to a disabled `Run` during a run, that is a minor variant —
   confirm the preference.
2. **Logs collapsed by default.** v2 flips it to collapsed (escape-hatch principle).
   If support workflows depend on logs being visible on entry, keep it expanded.
3. **Context bar vs. auto-resolve only.** With one auto-selected instance for most
   users, is the visible Workspace+Instance row still wanted, or should it collapse
   to a single muted line (`Running on <instance>`) with a click-to-change? v2 keeps
   the two selectors for the multi-instance power user; flag if you want it quieter.
