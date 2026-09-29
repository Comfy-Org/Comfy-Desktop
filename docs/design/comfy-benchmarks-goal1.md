# Comfy Benchmarks — Goal 1 (Standard suite + rich metrics)

Screen spec for an **incremental** extension of the existing performance-test screen.
Build target: `src/renderer/src/views/PerformanceTestView.vue`. No new route, no new
top-level view. Reuse existing components; one small new component is called out.

- **Owner:** designer
- **Implements against:** `PerformanceTestView.vue`, `BenchmarksView.vue` (history/compare, unchanged), shared `deriveGpuTier` (`src/shared/gpuTier.ts`)
- **Persona:** VFX artist (5–25 yr). Has a GPU, does not configure Python. Wants one honest number ("how fast is my machine on a real workflow?") without reading a form. Secondary: power user who still needs Bring-Your-Own workflow, warm-up/measured counts, raw logs.

---

## 0. What changes, in one paragraph

Today the run screen only accepts a dragged/imported workflow file. We add a **source
toggle** at the top of the middle column: **Standard benchmark** (new default) vs **My
workflow** (the existing BYO drop-zone, unchanged). Picking a standard benchmark selects a
curated workflow the Desktop already ships, so the artist never touches a file. The run
pipeline gains explicit, legible phases (**download → warm-up → measured**). Results **lead
with sec/image**, then **VRAM peak**, with copy that is correct on CUDA, MPS (Apple unified
memory), and CPU, a **spread/variance hint** so the number is trustworthy, and a **delta vs
the user's previous run of the same benchmark**.

Everything the BYO path does today keeps working. Nothing is removed.

---

## 1. Guiding principles for this feature

1. **One obvious primary action.** The screen always resolves to a single `Run benchmark` button. Source choice, instance, and counts are secondary.
2. **Honest metrics or no metric.** We never fabricate a number we cannot measure. `it/s` is shown only when the benchmark manifest declares a step count and the backend reports steps; otherwise it is omitted, not guessed. sec/**image** is only labelled "image" when we know images-per-run; otherwise it reads sec/**run**.
3. **Backend-aware truth.** "VRAM" and "fits your VRAM" appear only on dedicated GPUs. On Apple Silicon we say "unified memory (shared with system RAM)". On CPU we say "system RAM". This is driven by `deriveGpuTier`, not by string-sniffing in the view.
4. **Trust through spread.** A single mean is not trustworthy. We lead with the **median** of N measured runs and always show run count + fastest–slowest range.
5. **Incremental, not a rewrite.** Reuse the existing three-column layout, progress track, results `<dl>`, and collapsible sections.

---

## 2. Data model (what the view needs)

### 2.1 Reuse as-is
- `PerformanceTestResultsSummary` / `AcceleratorSnapshot`: `fastest/slowest/average/median JobDurationSeconds`, `measuredJobCount`, `failedRunCount`, `hardware.{deviceType,backend,vramMb,ramMb,deviceName}`, `systemInfo`.
- `deriveGpuTier({ vendor, vramGb })` → `'high'|'mid'|'low'|'sub_low'|'apple'|'cpu_only'`. Map `hardware.backend`/`deviceType` to `vendor` (`cuda`→`nvidia`, `mps`→`apple`, `cpu`/null→cpu_only; `hip`/`rocm`→`amd`).
- `listPerformanceTestBenchmarks()` for the compare-to-previous lookup.

### 2.2 New — curated benchmark manifest (small, static, ships with the app)
A short list (target: 3–5) of standard benchmarks, derived from workflows the Desktop already
shows in the starter-template picker. Each entry (design contract; backend owns the file):

```ts
interface StandardBenchmark {
  id: string                 // stable, used as workflowName + compare key, e.g. 'sd15-txt2img-512'
  name: string               // 'SD1.5 · 512 Text-to-Image'
  measures: string           // one line: 'Baseline txt2image throughput at 512px, 20 steps'
  vramTierGb: number         // recommended dedicated VRAM, e.g. 6 / 12 / 24
  downloadBytes: number      // total model bytes fetched on first run
  modelsPresent: boolean     // resolved at load, like TemplatePickerStep's modelsPresent
  imagesPerRun: number       // 1 for all Goal-1 benchmarks → enables honest 'sec/image'
  samplerSteps: number | null// declared steps; enables it/s. null → it/s hidden
  thumbnailUrl?: string
}
```

### 2.3 New — richer result fields (backend dependency, flagged in Open Questions)
- `hardware.peakVramMb: number | null` — peak allocator memory during measured runs. Required for the "VRAM peak" headline. Until it lands, the VRAM peak block renders its **absent state** (see §5.4), it does not crash.
- Optional `perImageIterationsPerSecond: number | null` — derived by backend as `samplerSteps / samplingSeconds`. If absent, it/s is omitted.

The view must treat both as optional. Goal 1 is shippable with duration-only metrics; peak VRAM and it/s light up as the backend fills them.

---

## 3. Layout map (incremental diff to the existing three columns)

```
┌───────────────────────────────────────────── Comfy · Benchmarks ─────────────────────────────┐
│  [wordmark]  Benchmarks                                              (DevPlatform account chip) │
│              Measure how your machine runs a real workflow.                                     │
│                                                                                                │
│  ┌── Instance ─────────────┐  ┌── Workflow ──────────────────────┐  ┌── Measurement ────────┐ │
│  │ Workspace   [selector ▾]│  │ ( • Standard )  ( My workflow )   │  │ Warm-up runs   [ 1 ]  │ │  <- source toggle is NEW
│  │ Instance    [selector ▾]│  │  ┌────────┐ ┌────────┐ ┌───────┐ │  │ Measured runs  [ 5 ]  │ │
│  │                         │  │  │ card   │ │ card   │ │ card  │ │  │                       │ │
│  │                         │  │  └────────┘ └────────┘ └───────┘ │  │        [Stop] [Run ▶] │ │
│  └─────────────────────────┘  └──────────────────────────────────┘  └───────────────────────┘ │
│                                                                                                │
│  ▸ Results                                                                                      │
│  ▸ Logs                                                                                         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Column 1 (**Instance**) — unchanged (`Workspace` + `Instance` selectors).
- Column 2 (**Workflow**) — gains the source toggle. In **Standard** mode it shows the benchmark cards; in **My workflow** mode it shows today's drop-zone verbatim.
- Column 3 (**Measurement**) — unchanged inputs; the primary `Run` button label is now `Run benchmark`.
- `Results` and `Logs` collapsibles — unchanged shells; the Results body is restructured (§5).

The `<h2>` for column 2 changes from `Drop a workflow` to `Choose a benchmark`.

---

## 4. Screen 1 — The picker

### 4.1 Source toggle (new)
A 2-option segmented control, styled like existing `secondary` pill buttons, sitting where the
`<h2>` used to introduce the drop-zone.

```
( ● Standard benchmark )  ( ○ My workflow )
```

- Default: **Standard benchmark**.
- `role="radiogroup"`, arrow-key navigable. Selection persists per session.
- Switching to **My workflow** reveals the existing drop-zone unchanged; switching back reveals the cards. The selected item in each mode is remembered while the screen is open.

### 4.2 Standard benchmark cards
A horizontal, wrap-to-2-row grid of selectable cards (reuse `ChoiceCard` with
`selectable`/`selected`, which already renders as a radio with border-driven selection — no
glyph, matches the template picker feel). Each card:

```
┌───────────────────────────────────────────────┐
│  SD1.5 · 512 Text-to-Image            ~6 GB ⬇  │   <- name (strong)          size/present badge
│  Baseline txt2image throughput,                │   <- measures (one line, muted)
│  512px · 20 steps                              │
│  ┌──────────┐                                  │
│  │ 6 GB tier│  Fits your VRAM                  │   <- tier chip + fit note (dedicated GPU only)
│  └──────────┘                                  │
└───────────────────────────────────────────────┘
```

Card contents, top to bottom:
1. **Name** (`choice-card__label`).
2. **What it measures** (`choice-card__desc`) — one line + a spec line `512px · 20 steps`.
3. **VRAM tier chip** — `6 GB tier` / `12 GB tier` / `24 GB+ tier`.
4. **Fit note**, right of chip — computed from `deriveGpuTier`:
   - Dedicated GPU with `vramGb >= vramTierGb` → `Fits your VRAM` (muted, no color-shout).
   - Dedicated GPU with `vramGb < vramTierGb` → `May exceed your VRAM` (caution, not an error — we still let them run; ComfyUI offloads).
   - Apple / CPU tiers → **no fit note** (fit is not meaningful); show `Recommended: 6 GB+` instead.
5. **Download badge** (top-right), reusing the template picker's convention:
   - Not present → `~6 GB ⬇` (download icon) with tooltip `Downloads on first run`.
   - Present → `Downloaded` (check) with tooltip `Downloaded · ~6 GB`.

Selecting a card sets it as the run target. Exactly one card is selected at a time; the first
card is preselected on first open so `Run benchmark` is immediately actionable.

### 4.3 First-run / empty states
- **Standard mode has no empty state** — the curated set always renders. That is the whole point: a first-time user lands on a runnable choice with zero setup.
- If the manifest fails to load (offline + never cached): show an inline state in the card area — `Couldn't load standard benchmarks. Switch to "My workflow" to run your own.` with a `Retry` link. The toggle still works.
- **My workflow** first-run state is today's drop-zone hint, unchanged: `Drop a workflow here, or click to choose a .json file`.

---

## 5. Screen 2 — Run states

All phases render inside the existing `Results` collapsible (auto-expanded on run). One phase is
visible at a time. The existing `.performance-test__progress-track` bar is reused; we add a
**phase label** and, where we have a denominator, a **count**. Keep copy calm — no spinners
theatre, just legible progress.

### 5.1 Idle (pre-run)
Results body shows the placeholder, restated for benchmarks:
`Run a benchmark to see throughput and memory for this machine.`

### 5.2 Model download (only if `modelsPresent === false`)
Shown before launch when the chosen benchmark's models are missing. Reuse the download-progress
pattern already used elsewhere (bytes + percent).

```
Downloading models for SD1.5 · 512 Text-to-Image
[■■■■■■■■□□□□□□□□]  4.1 / 6.0 GB
This happens once. Future runs of this benchmark skip straight to warm-up.
```

- Sub-label reassures it is a one-time cost (persona anxiety: "is this going to download forever?").
- `Stop` cancels the download and returns to idle.
- BYO mode never shows this (user brought their own workflow; models are their responsibility).

### 5.3 Warm-up (not measured)
```
Warming up · run 1 of 1 (not measured)
[■■■■■■■■■■■■■■□□]
Warm-up primes caches and compiles kernels. These runs are discarded.
```

- The `(not measured)` tag is load-bearing honesty — the first run is always slow and must not pollute the number.
- Progress bar tracks warm-up runs completed / total warm-up runs.

### 5.4 Measured runs
```
Measuring · run 3 of 5
[■■■■■■■■■□□□□□□□]   ~00:42 remaining
```

- Count `run X of N` maps to `completedProgressRuns` within the measured segment (offset past warm-up).
- **Remaining estimate** (`~mm:ss remaining`) = median of completed measured runs × remaining runs. Only shown once ≥1 measured run has completed (before that, omit — do not guess). Prefix `~` always.
- `Stop` remains available through every phase; stopping mid-measure keeps whatever completed runs exist but marks the result `Partial (stopped after 2 of 5)`.

### 5.5 Error states (inline, in Results body)
- Launch failed → `Couldn't start the instance. See Logs for details.` + auto-expand Logs.
- Out of memory (detected from log bucket `CUDAOutOfMemory` / MPS OOM) → `Ran out of memory on this benchmark. Try a lower VRAM tier benchmark, or free up memory and rerun.`
- All measured runs failed → `No runs completed. See Logs for details.`
- These reuse the existing `workflow-error` / results-placeholder styling (danger token).

---

## 6. Screen 3 — Results (the heart of Goal 1)

Restructures the Results body into a **headline band** + **supporting stats** + **system info**
(existing) + **compare** row. Reuses `.performance-test__result-list` `<dl>` and the aggregate
bar chart. New: a headline stat pair and a compare line. Suggest one small new component
`BenchmarkHeadlineStat.vue` for the two big numbers (or inline — see §8).

### 6.1 Headline band — lead with sec/image, then VRAM peak

```
┌──────────────────────────────┬──────────────────────────────┐
│  2.14 s / image              │  7.8 GB  VRAM peak            │
│  median of 5 runs            │  of 12 GB · fits              │
│  ▲ 12% faster than last run  │                              │
└──────────────────────────────┴──────────────────────────────┘
  range 2.05–2.61 s · avg 2.22 s · 5 runs, 0 failed
```

- **Left / primary metric = median sec/image.**
  - Value = `medianJobDurationSeconds / imagesPerRun`. Big number (reuse the 24px `dd`, bumped to ~32px for the headline).
  - Unit label: `s / image` when `imagesPerRun` is known (all standard benchmarks); `s / run` for BYO where images-per-run is unknown.
  - Sub-label: `median of {N} runs`.
  - **Why median, not mean:** median resists a single slow outlier, so the headline number is reproducible. Mean is still shown in the sub-row for continuity with today's export.
- **Optional it/s line** under the headline, only when `samplerSteps` present and backend reports it: `~7.4 it/s`. Prefix `~`. Omit entirely otherwise (no zero, no dash).
- **Right / secondary metric = VRAM peak** (backend-aware, §6.3).
- **Sub-row (full width, muted):** `range {fastest}–{slowest} s · avg {avg} s · {N} runs, {failed} failed`. This is the trust/variance hint. If `failed > 0`, color the failed count with the danger token.

### 6.2 Compare vs previous run (delta)
Match rule: newest prior benchmark with the **same `id`/workflowName AND same `hardwareName`**
(so we compare like machine to like machine). Delta computed on median sec/image.

- Faster: `▲ 12% faster than last run (2.43 s)` — positive/success token.
- Slower: `▼ 8% slower than last run (1.98 s)` — danger token.
- Within ±2%: `≈ same as last run (2.16 s)` — muted (avoid crying wolf over noise).
- No prior run: `First run of this benchmark — no comparison yet.` — muted.
- Prior run exists but on different hardware only: `Last run was on a different GPU — not compared.` — muted.

Arrows are ASCII/lucide (`ArrowUp`/`ArrowDown`), not emoji. "Faster is up/green" holds regardless of the metric being a duration, because we phrase it as speed, not seconds.

### 6.3 VRAM peak — backend-aware copy (the cross-platform crux)

Driven entirely by `deriveGpuTier(vendor, vramGb)`:

| Tier (from deriveGpuTier) | Headline label | Second line | Fit shown? |
|---|---|---|---|
| `high` / `mid` / `low` / `sub_low` (NVIDIA/AMD dedicated) | `{peak} GB  VRAM peak` | `of {total} GB · {fit}` | Yes: `fits` if peak ≤ total, `exceeded — offloaded to RAM` if peak > total |
| `apple` (MPS) | `{peak} GB  memory peak` | `unified memory (shared with system RAM)` | **No.** Never imply dedicated VRAM. Never show "fits your VRAM". |
| `cpu_only` (no accelerator) | `{peak} GB  system RAM peak` | `of {total} GB RAM` | No VRAM concept; show RAM headroom only if `ramMb` known |

Rules:
- The word **"VRAM"** appears only on dedicated-GPU tiers. On Apple it is "memory"; on CPU it is "system RAM".
- **"fits your VRAM" / fit judgement** renders only on dedicated-GPU tiers, where `total` = `hardware.vramMb`. It is meaningless on unified/shared memory, so it is suppressed there.
- **Absent state** (backend hasn't provided `peakVramMb` yet, or value is null): render the right cell as `VRAM peak — not measured` (dedicated) / `Memory peak — not measured` (apple/cpu), muted. The screen never blanks or errors on a missing peak.
- Total on Apple: do not print `of X GB` against unified memory as if it were a VRAM budget. If we want to show capacity, print `system memory {ramMb} GB` on its own line, clearly labelled as system memory.

### 6.4 Below the headline — existing detail, retained
- The four-bar aggregate chart (fastest/slowest/avg/median) stays, under a `Run durations` heading. It visually backs up the range claim.
- `System information` section stays exactly as today (device, VRAM/RAM, PyTorch, xFormers, CPU, cores, arch, OS). One copy change: the `VRAM` row label follows the same backend rule — `Unified memory` on Apple, `VRAM` on dedicated, `System RAM` on CPU.
- Actions row unchanged: `Open results folder`, `Export results image`. The exported image should carry the same backend-correct labels (the SVG builder in `performanceTestResultsSvg.ts` gets the same label strings).

### 6.5 Results header context line
Above the headline band, a single muted line names what was run so a saved screenshot is self-explanatory:
`SD1.5 · 512 Text-to-Image  ·  RTX 4070 (12 GB)  ·  Sep 28, 2026 3:14 PM`
(For BYO: the workflow filename replaces the benchmark name.)

---

## 7. Copy deck (exact strings + i18n keys)

Add under a new `benchmarks.run.*` namespace (or extend `performanceTest.*` — pick one; keys below use `performanceTest.*` to stay with the view). `{n}` are ICU params.

| Key | String |
|---|---|
| `performanceTest.title` | `Benchmarks` |
| `performanceTest.description` | `Measure how your machine runs a real workflow.` |
| `performanceTest.sourceStandard` | `Standard benchmark` |
| `performanceTest.sourceCustom` | `My workflow` |
| `performanceTest.chooseBenchmark` | `Choose a benchmark` |
| `performanceTest.benchmarkMeasuresPrefix` | `Measures:` |
| `performanceTest.tierChip` | `{gb} GB tier` |
| `performanceTest.tierRecommended` | `Recommended: {gb} GB+` |
| `performanceTest.fitsVram` | `Fits your VRAM` |
| `performanceTest.mayExceedVram` | `May exceed your VRAM` |
| `performanceTest.downloadsOnFirstRun` | `Downloads on first run` |
| `performanceTest.downloadedWithSize` | `Downloaded · ~{size}` |
| `performanceTest.manifestLoadError` | `Couldn't load standard benchmarks. Switch to "My workflow" to run your own.` |
| `performanceTest.retry` | `Retry` |
| `performanceTest.run` | `Run benchmark` |
| `performanceTest.running` | `Running…` |
| `performanceTest.stop` | `Stop` |
| `performanceTest.stopping` | `Stopping…` |
| `performanceTest.warmupRuns` | `Warm-up runs` |
| `performanceTest.measuredRuns` | `Measured runs` |
| `performanceTest.idlePlaceholder` | `Run a benchmark to see throughput and memory for this machine.` |
| `performanceTest.downloadingModels` | `Downloading models for {name}` |
| `performanceTest.downloadOnceNote` | `This happens once. Future runs of this benchmark skip straight to warm-up.` |
| `performanceTest.warmingUp` | `Warming up · run {done} of {total} (not measured)` |
| `performanceTest.warmupNote` | `Warm-up primes caches and compiles kernels. These runs are discarded.` |
| `performanceTest.measuring` | `Measuring · run {done} of {total}` |
| `performanceTest.remaining` | `~{time} remaining` |
| `performanceTest.partialStopped` | `Partial (stopped after {done} of {total})` |
| `performanceTest.secPerImage` | `s / image` |
| `performanceTest.secPerRun` | `s / run` |
| `performanceTest.medianOfRuns` | `median of {n} runs` |
| `performanceTest.itsPerSecond` | `~{its} it/s` |
| `performanceTest.rangeRow` | `range {min}–{max} s · avg {avg} s · {n} runs, {failed} failed` |
| `performanceTest.vramPeak` | `VRAM peak` |
| `performanceTest.memoryPeak` | `memory peak` |
| `performanceTest.systemRamPeak` | `system RAM peak` |
| `performanceTest.vramPeakOfTotalFits` | `of {total} GB · fits` |
| `performanceTest.vramPeakExceeded` | `of {total} GB · exceeded — offloaded to RAM` |
| `performanceTest.unifiedMemoryNote` | `unified memory (shared with system RAM)` |
| `performanceTest.ofRam` | `of {total} GB RAM` |
| `performanceTest.peakNotMeasured` | `— not measured` |
| `performanceTest.deltaFaster` | `{pct}% faster than last run ({prev} s)` |
| `performanceTest.deltaSlower` | `{pct}% slower than last run ({prev} s)` |
| `performanceTest.deltaSame` | `same as last run ({prev} s)` |
| `performanceTest.deltaFirstRun` | `First run of this benchmark — no comparison yet.` |
| `performanceTest.deltaDifferentGpu` | `Last run was on a different GPU — not compared.` |
| `performanceTest.contextLine` | `{name} · {device} · {datetime}` |
| `performanceTest.runDurations` | `Run durations` |
| `performanceTest.oomError` | `Ran out of memory on this benchmark. Try a lower VRAM tier benchmark, or free up memory and rerun.` |
| `performanceTest.launchError` | `Couldn't start the instance. See Logs for details.` |
| `performanceTest.noRunsError` | `No runs completed. See Logs for details.` |

Copy rules applied: no em dashes replaced (kept as intentional typographic dashes in UI strings only, not prose), no emoji, "warm-up" hyphenated consistently, sentence case for all labels, `~` prefixes every estimate.

---

## 8. Implementation notes (keep it incremental)

**Reuse directly:**
- `BrandBackground`, `BrandedPageHeader`, `CollapsibleSectionToggle`, `BaseSelect`, `DevPlatform*` — unchanged.
- `ChoiceCard` (with `selectable`/`selected`) for benchmark cards — no new card component needed; pass `label`=name, `description`=measures, and use the `desc-trailing` / `label-trailing` slots for the tier chip and download badge.
- Existing `.performance-test__progress` + `.performance-test__progress-track` for all run phases; drive the phase label from a new `runPhase` ref (`'idle'|'downloading'|'warmup'|'measuring'|'done'|'error'`).
- Existing `.performance-test__result-list` `<dl>` + `aggregateChart` for the retained detail region.
- `deriveGpuTier` from `src/shared/gpuTier.ts` for both the card fit note and the VRAM-peak block. Single source of truth; do not branch on raw backend strings in the template.
- `listPerformanceTestBenchmarks` for compare-to-previous (filter by id + hardwareName, newest).

**New, small:**
- `BenchmarkHeadlineStat.vue` (optional) — renders one big value + unit + sub-label, used twice (sec/image and VRAM peak). Keeps the template readable. If preferred, inline as two `<dl>` blocks and skip the component.
- A pure helper `benchmarkMetrics.ts`: `perImageSeconds()`, `spreadLabel()`, `vramPeakView(tier, peakMb, totalMb, ramMb)` returning `{ label, secondLine, tone }`, and `compareToPrevious()`. Unit-testable, keeps backend-aware logic out of the view. This is where all the cross-platform branching lives.

**State additions in the view (`<script setup>`):**
- `benchmarkSource: 'standard' | 'custom'` (default `'standard'`).
- `standardBenchmarks`, `selectedBenchmarkId`, `manifestError`.
- `runPhase` + `downloadedBytes`/`totalBytes` for the download phase.
- `canRun` gains: standard mode requires `selectedBenchmarkId`; custom mode keeps requiring `workflowFilePath`.

**Do not touch:** `BenchmarksView.vue` (history/compare) beyond it naturally picking up new result fields; the raw logs section; the export path's structure (only its label strings gain the backend rule).

---

## 9. Open questions (need Deep / backend call)

1. **Peak VRAM source.** `peakVramMb` does not exist in the results schema today. Who emits it — ComfyUI Core (`torch.cuda.max_memory_allocated` / MPS `driver_allocated_memory`) surfaced through the jobs API, or a Desktop-side sampler? Goal 1 ships duration-only if this slips; the UI degrades to the "not measured" state. Confirm target.
2. **it/s feasibility.** it/s needs sampler step count per run. Can the curated manifest declare `samplerSteps` reliably (fixed workflows), and can the backend split sampling time from total job time? If not, we ship without it/s (no fabrication) — acceptable for Goal 1?
3. **Which 3–5 workflows are the standard set?** Should map to existing starter templates so models/thumbnails are already wired. Need the final list + per-benchmark VRAM tier and download size. Proposed axis: one low (SD1.5 512), one mid (SDXL 1024), one high (a Flux/video tier) so every GPU tier has a meaningful run.
4. **Median vs mean as the headline.** Spec leads with **median** for reproducibility; today's export/telemetry emphasize mean. OK to make median the hero and keep mean in the sub-row, or must the hero stay mean for continuity?
5. **Compare scope.** Match previous run on `id + hardwareName`. If a user has multiple instances/GPUs, is same-`hardwareName` the right equivalence, or should we also require same instance? (Affects how often "not compared" shows.)
