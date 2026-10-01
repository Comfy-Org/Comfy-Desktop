# Comfy Benchmarks — Goal 1: History, Comparison & Export

**Owner:** designer · **Build target:** rework `BenchmarksView.vue` into **History**, extract a new **Compare** view · **Status:** ready to build
**Grounded in:** the rich `CoreBenchmarkSummary` (schema v3) already persisted in every `<session>/results.json`, the single-run dashboard in `PerformanceTestView.vue` (the visual language this must match), and `comfy-benchmarks-goal1-ux.md` (which owns the single-run results screen).

> North star for this slice: the single run is already a product. This is the **corpus** around it — browse many runs, put any set side by side (even across workflows), and get the numbers out of the app. Every metric shown is one we measured. We never editorialize a number and we never imply two different workflows are "the same work."

---

## 0. Scope & the one hard rule

In scope: **History** (browse/filter/sort/rename/delete), **Compare** (2+ runs, including different workflows), **Export** (single-run PNG, comparison PNG, data CSV/JSON), and the **navigation** tying run → history → compare → export and history → open → re-run.

Out of scope: the single-run dashboard itself (owned by the other doc), any publish/leaderboard/network egress (local-only for Goal 1), new capture fields (nothing new to measure — it is all in `coreBenchmark`).

**The hard rule (user, non-negotiable): no editorializing.** A label states what a number *is*. It never injects interpretation or alarm. The v1 HTML reference says "Almost no headroom … will likely spill to system RAM or OOM" — that is exactly what we do **not** ship. The factual version is `31.7 GB of 32.6 GB (97%)`, tone neutral. The *only* flags we raise are genuinely abnormal machine states, stated as plain fact: `Offloaded to RAM` (`device.offloaded === true`) and `Throttled` (`resources.peak.throttled === true` / `summary.throttled === true`). Color (`--success` / `--danger`) appears **only on a delta chip**, never on a standalone value.

---

## 1. Rework vs replace — the decision

**Rework `BenchmarksView.vue`'s data + presentation; keep its plumbing; extract Compare into its own view.**

Keep (works, tested, no reason to touch):
- IPC: `listPerformanceTestBenchmarks`, `renamePerformanceTestBenchmark`, `deletePerformanceTestBenchmark`, `exportResultsImage`, `browseFolder`.
- Folder picker, refresh, search, the four filters (workspace / instance / hardware / workflow), rename-in-place, delete-with-confirm, row selection + series colors.

Replace / add:
- **Row content.** Today a row is duration-only (fastest/avg/median/slowest/runs). Replace with the rich at-a-glance metrics (sec/image, steady-state it/s, VRAM peak, energy, GPU, workflow, date) read from `coreBenchmark`. The data is already present — `PerformanceTestBenchmark.result` is the complete `results.json`, so `result.coreBenchmark.*` is readable today via the existing `flattenResult`. **Recommended:** add typed convenience fields to the `PerformanceTestBenchmark` IPC shape (`coreBenchmark?: CoreBenchmarkSummary | null`) so History doesn't parse flattened dotted keys. (Backend ask — small, see P0.)
- **Compare.** Today compare is an inline collapsible section under the table that only diffs durations and only exports an image. Replace with a **dedicated full-screen Compare view** (new route) reached by selecting 2+ rows and pressing **Compare**. The inline section is removed from History.
- **Column picker over arbitrary flattened keys** → a small curated **metric column toggle** (the generic "any dotted key" picker is admin surface; the curated set is the product).
- **Old SVG helpers** (`createBenchmarkComparisonSvg`, the CSS-positioned duration-range chart) → the inline-SVG chart suite with real axes from `benchmarkCharts.ts`, matching the single-run dashboard.

Net: `BenchmarksView.vue` becomes `HistoryView` (or stays named, re-skinned); a new `BenchmarkCompareView` owns the comparison. No data migration — reads the same files.

---

## 2. Information architecture & navigation

The benchmark area is three screens behind one entry. A segmented control in the header switches **Run** ↔ **History**; **Compare** and **single-run view** are pushed states, not tabs.

```
Benchmarks (nav entry)
│
├─ Run         → PerformanceTestView   (pick → run → single-run dashboard)
│                   └─ [View in History]  ──────────────┐
│                   └─ [Compare vs previous] ───────────┼──┐
│                   └─ [Export image ▸]                 │  │
│                                                       ▼  │
├─ History     → HistoryView (reworked BenchmarksView)     │
│                   ├─ row click ───────► Single-run view ─┘ (same dashboard, read-only)
│                   │                         └─ [Run again] → Run (prefilled)
│                   ├─ select 2+ ─► [Compare (N)] ─────────┐
│                   └─ [Export ▸] (CSV / JSON of selection)│
│                                                          ▼
└─ Compare     → BenchmarkCompareView  (table + paired charts)
                    ├─ [Export image]  (comparison PNG)
                    ├─ [Export data ▸] (CSV / JSON)
                    └─ [Back to History]
```

**Flow A — run to shareable comparison:** Run → dashboard → *View in History* → multiselect this run + a prior GPU's run → *Compare (2)* → *Export image*. 
**Flow B — re-run from history:** History → row click → single-run dashboard → *Run again* (prefills the same workflow + config in Run). 
**Flow C — numbers leave the app:** History → filter to a workflow → *Select all* → *Export ▸ CSV* → opens in a spreadsheet / goes into a corpus.

Entry points to Compare (all converge on the same view):
1. History: select ≥2 rows → **Compare (N)** button (primary, appears in a selection action bar).
2. Single-run dashboard: **Compare vs previous** → opens Compare pre-loaded with this run + the newest prior run of the *same benchmark on the same GPU* (the §5.1 match from the other doc). If no match exists, it opens Compare with just this run and a "pick runs to compare" prompt.

---

## 3. History view

### 3.1 Layout

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  Benchmarks                                        [ Run ] [ History ]        (account)  │  ← segmented
│  Browse every run, compare any set, export the numbers.                                  │
├───────────────────────────────────────────────────────────────────────────────────────┤
│  [⌖ Open folder] [↻]   [🔍 Search runs            ]  [Workflow ▾][GPU ▾][Instance ▾]     │
│                                                       [Workspace ▾]  [⚙ Columns]  [Sort ▾]│
├──┬──────────────────┬─────────┬─────────┬──────────┬────────┬──────────────┬──────┬─────┤
│☐ │ WORKFLOW         │ SEC/IMG │ IT/S    │ VRAM PEAK│ ENERGY │ GPU          │ DATE │     │
│  │                  │   ▲     │         │          │        │              │      │     │
├──┼──────────────────┼─────────┼─────────┼──────────┼────────┼──────────────┼──────┼─────┤
│☑ │ Z-Image Turbo    │ 1.12 s  │ 24.8    │ 11.4 GB  │ 0.21 Wh│ RTX 5090     │ Sep30│ ⋯   │
│  │ Text to Image    │         │         │ 35% ·32GB│ /image │ 32 GB        │ 20:51│     │
├──┼──────────────────┼─────────┼─────────┼──────────┼────────┼──────────────┼──────┼─────┤
│☑ │ Qwen-Image       │ 3.47 s  │ 7.9     │ 18.9 GB  │ 1.04 Wh│ RTX 5090     │ Sep30│ ⋯   │
│  │ Text to Image    │         │         │ 58% ·32GB│ /image │ 32 GB        │ 20:33│     │
├──┼──────────────────┼─────────┼─────────┼──────────┼────────┼──────────────┼──────┼─────┤
│☐ │ Flux.1-dev       │ 4.80 s  │ 4.17 ⚑  │ 23.1 GB  │ 1.98 Wh│ RTX 4090     │ Sep29│ ⋯   │
│  │ Text to Image    │         │         │ 96% ·24GB│ /image │ 24 GB        │ 18:02│     │
└──┴──────────────────┴─────────┴─────────┴──────────┴────────┴──────────────┴──────┴─────┘
   3 of 12 selected                                   [ Export ▾ ]      [ Compare (3) → ]
```

- **Row = one run.** Primary line = `workflowName`; sub-line = modality/task (`run.imageCount` + resolution if useful) muted. Each metric cell is a value + a muted qualifier line (percent-of-total under VRAM, `/image` under energy, capacity under GPU). Tabular numerals throughout.
- **No colored values.** The only non-neutral marks are factual flags: a small `⚑` glyph (muted amber `--comfy-yellow`, used as a *flag*, not alarm) next to a metric when `offloaded` or `throttled` is true, with a tooltip `Offloaded to RAM` / `Thermal throttling`. The flag is informational, not a judgment.
- **Row click** (anywhere outside the checkbox / actions) opens that run's full single-run dashboard. Checkbox selects for compare. `⋯` opens the row menu: **Open**, **Run again**, **Rename**, **Reveal in folder**, **Delete**.
- **Rename** stays inline (keep today's editor) under the `⋯` menu + double-click on the workflow cell.
- **Selection action bar** (bottom, appears when ≥1 selected): `N of M selected · [Export ▾] · [Compare (N) →]`. Compare is disabled at <2 and enabled at ≥2 (cap at a sane max of 5 columns for legibility; 6th+ selection shows "Compare uses the first 5").

### 3.2 Columns (curated, toggleable)

Default visible: **Workflow · Sec/image · It/s · VRAM peak · Energy · GPU · Date**. 
Toggle-on extras: Peak power (W) · Peak temp (°C) · GPU util (%) · Steps · Weight dtype · Attention · CUDA · Instance · Workspace · Runs (measured/failed) · Session id.

Rule: Workflow + Date are always on. Everything else is in the `⚙ Columns` menu (replaces the arbitrary-dotted-key picker). Each column pulls from one `coreBenchmark` field; a run missing that field renders `—` (not measured) — never 0, never blank.

### 3.3 Sorting

A single `Sort ▾` with: **Date (newest)** · Date (oldest) · Fastest (sec/image ↑) · Slowest · Highest it/s · Lowest VRAM peak · Highest VRAM peak · Lowest energy · Workflow (A–Z). Clicking a sortable column header also sorts by it (↑/↓ indicator), mirroring today's behavior. Null metrics always sort last regardless of direction.

> Cross-workflow caveat on sorting: sorting a *mixed-workflow* list by "Fastest (sec/image)" is honest within the list (it is just an attribute of each run) but is **not** a ranking of workflows against each other. We do not add leaderboard framing, badges, or "fastest overall" copy. The number is the number.

### 3.4 Empty & edge states

| State | Trigger | Body | Primary action |
|---|---|---|---|
| First run / empty | 0 saved runs | Centered: "No benchmarks yet. Run one to start building history." + a thumbnail of the dashboard | **Run a benchmark** → Run tab |
| No matches | filters exclude all | "No runs match these filters." | **Clear filters** |
| Load error | folder unreadable | "Couldn't read the benchmarks folder." | **Retry** / **Open folder** |
| Partial run | a run has `coreBenchmark` but v1/missing leaves | row renders what exists, `—` for the rest; no crash | — |
| Needs-capture run | `coreBenchmark == null` (old ComfyUI) | row shows workflow + date + duration only; metric cells `—`; tooltip "No capture — update ComfyUI" | opens dashboard's needs-capture state |

---

## 4. Compare view

The headline new capability. Two or more runs become columns. Works for **same-workflow A/B** (true benchmark) and **cross-workflow** (different work — handled honestly, §4.3).

### 4.1 Layout

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  ← Back to History          Compare 3 runs            [Export image] [Export data ▾]     │
│  Baseline: [ Z-Image Turbo (5090) ▾ ]          ⓘ Different workflows — see note below    │
├─────────────────────────────┬──────────────┬──────────────┬───────────────┬────────────┤
│ METRIC                       │ ● Z-Image     │ ● Qwen-Image  │ ● Ideogram v4 │            │
│                              │   RTX 5090    │   RTX 5090    │   RTX 5090    │            │
│                              │   (baseline)  │               │               │            │
├─────────────────────────────┼──────────────┼──────────────┼───────────────┼────────────┤
│ ▸ Per-workload (comparable across workflows)                                             │
│ Steady-state it/s           │ 24.8          │ 7.9  ▼ 68%   │ 2.34 ▼ 91%    │  higher=good│
│ VRAM peak                   │ 11.4 GB       │ 18.9 ▲+7.5GB │ 31.7 ▲+20.3GB │  lower=good │
│ Energy / image              │ 0.21 Wh       │ 1.04 ▲+0.83  │ 2.33 ▲+2.12   │  lower=good │
│ Peak power                  │ 540 W         │ 558  ▲+18 W  │ 561  ▲+21 W   │  lower=good │
│ Peak temp                   │ 68 °C         │ 72  ▲+4 °C   │ 75  ▲+7 °C    │  lower=good │
│ Peak GPU util               │ 99 %          │ 100 ≈        │ 100 ≈         │             │
├─────────────────────────────┼──────────────┼──────────────┼───────────────┼────────────┤
│ ▸ Per-run (depends on the workflow — not comparable across different workflows)          │
│ Sec / image                 │ 1.12 s        │ 3.47 s  ✕    │ 27.6 s  ✕      │  ✕ diff. wf │
│ Median run duration         │ 1.12 s        │ 3.47 s  ✕    │ 27.6 s  ✕      │             │
│ Steps                       │ 8             │ 20      ✕    │ 20      ✕      │             │
├─────────────────────────────┼──────────────┼──────────────┼───────────────┼────────────┤
│ ▸ Configuration (differences highlighted)                                                │
│ GPU                         │ RTX 5090 32GB │ RTX 5090 32GB│ RTX 5090 32GB │  same       │
│ Weight dtype                │ fp8_e4m3fn    │ fp8_e4m3fn   │ bfloat16  ⟵   │  differs    │
│ Attention                   │ sage          │ sage         │ pytorch   ⟵   │  differs    │
│ CUDA / cuDNN                │ 12.8 / 9.7    │ 12.8 / 9.7   │ 13.0 / 9.12 ⟵ │  differs    │
│ ComfyUI                     │ 0.34.0        │ 0.34.0       │ 0.34.0       │  same       │
│ Date                        │ Sep 30 20:51  │ Sep 30 20:33 │ Sep 30 20:44 │             │
└─────────────────────────────┴──────────────┴──────────────┴───────────────┴────────────┘

Where the time went (per workflow)                         Per-step it/s (overlaid)
┌───────────────────────────┐ ┌─────────────────────────┐ ┌──────────────────────────────┐
│ Z-Image   KSampler ███ 71% │ │ Qwen  KSampler ████ 83% │ │ 25 ─ Z-Image ●●●●●●●●         │
│           VAEDecode █  12% │ │       TextEnc  █    9%  │ │  8 ─ Qwen    ●●●●●●●●         │
│           ...              │ │       ...               │ │  2 ─ Ideogram●●●●●●●●         │
└───────────────────────────┘ └─────────────────────────┘ └──────────────────────────────┘

VRAM over time (overlaid, per-run color)                   Power / temp (overlaid)
┌─────────────────────────────────────────┐               ┌──────────────────────────────┐
│ 32 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ceiling (5090 32GB) │               │ (power solid, temp dashed,    │
│    Ideogram ▁▂▅▇▇▇  Qwen ▁▃▅▅  Z ▁▂▃     │               │  one hue per run)             │
└─────────────────────────────────────────┘               └──────────────────────────────┘
```

- Columns carry the **series color** (reuse today's `seriesColors` dot) so the table legend and every chart agree.
- **Baseline selector** picks which column deltas are measured against (default: leftmost / first-selected). Changing it recomputes every delta chip; it does not reorder columns.
- Column headers are reorderable (keep today's drag + Alt+←/→ keyboard reorder and a11y hints).

### 4.2 The metrics table — delta rules

Each non-baseline cell shows `value  <delta chip>`. **Only the delta chip is colored.** Values are always neutral plum.

Delta direction → color by **outcome**, not by sign:
- **Lower-is-better** metrics (sec/image, run duration, VRAM peak, energy, power, temp): a *lower* value than baseline is `--success`, higher is `--danger`.
- **Higher-is-better** metrics (steady-state it/s, GPU util is treated neutral): a *higher* value is `--success`, lower is `--danger`.
- Within **±2%** → muted `≈` chip (don't cry wolf over noise). This matches `SAME_BAND_PCT` in `benchmarkMetrics.ts`.
- Baseline column shows the raw value and the muted word `baseline` (no chip).
- Missing on either side → `—` chip, muted (not measured; no color).

Delta chip content: percent for ratio-friendly metrics (`▲ 14%`, `▼ 68%`) with the absolute in a tooltip; absolute for small-integer/degree metrics where percent misleads (`▲ +4 °C`, `▲ +18 W`, `▲ +7.5 GB`). Pick per-metric, specified in the build table (§7).

Rows are grouped into three bands with sticky sub-headers:
1. **Per-workload (comparable across workflows)** — it/s, VRAM peak, VRAM %, energy/image, power, temp, GPU util. These describe *how the machine behaved*, independent of how much work the workflow asked for, so they are honest to compare even across different workflows.
2. **Per-run (workflow-dependent)** — sec/image, median run duration, node total time, steps. Comparable **only** between same-workflow columns.
3. **Configuration** — GPU, dtype, attention, CUDA/cuDNN, PyTorch, VRAM state, ComfyUI version, date. Cells that **differ from baseline** get a muted `⟵` marker + the right column lists `differs`/`same`; this is the "config that changed" surface that explains an A/B delta.

### 4.3 Cross-workflow honesty (the headline)

On load, group selected runs by `workflowName` (fallback `run.benchmarkId`).

- **All same workflow → A/B mode.** Every band gets live deltas, including per-run (sec/image is a true apples-to-apples speedup). The header shows `Same workflow · A/B` and the Configuration band is the star — it surfaces the one thing that changed (GPU, or dtype, or a code change between runs on the same GPU).
- **Mixed workflows → cross-workflow mode.** The header shows a neutral note: `Different workflows — per-run metrics (sec/image, duration, steps) aren't comparable; compare it/s, VRAM, energy and power instead.` In the table:
  - Per-workload band: full deltas (these are fair).
  - Per-run band: values shown, **delta cell shows `✕` (muted) with tooltip "different workflow — not compared."** No color, no percent. We never render a green/red speedup between two different workloads.
  - The op-timeline charts render **side by side, one panel per workflow** (not stacked/diffed) — "which nodes dominate *this* workflow" — because diffing node bars across different graphs is meaningless.
- **Partially mixed** (e.g. 2× Flux + 1× Qwen): per-run deltas render **only between columns sharing the baseline's workflow**; the odd-workflow column shows `✕` on per-run rows. (If the baseline itself is the odd one out, per-run deltas are all `✕`; the user can switch baseline.)

The four named cases the task calls out, mapped:
| Case | Mode | What's the story |
|---|---|---|
| This GPU vs another GPU, same workflow | A/B | per-run deltas valid; Config band highlights the GPU row |
| Before/after my change, same workflow+GPU | A/B | per-run deltas valid; Config band highlights dtype/attention/ComfyUI/driver that changed |
| Model vs model, same GPU (Z vs Qwen vs Ideogram) | cross-workflow | per-workload deltas (it/s, VRAM, energy, power); per-run `✕`; side-by-side op-timelines |
| Mixed set | partial | per-run deltas only within the baseline's workflow |

### 4.4 Paired / overlaid charts

All inline SVG with real axes via `benchmarkCharts.ts`, matching the single-run dashboard's quality (1px grid, Inter ticks, no gradients except a single VRAM area fill, animate-in once).

| Chart | Cross-workflow | Same-workflow A/B | Degrade |
|---|---|---|---|
| **Op-timeline** | one small panel per workflow, side by side (top nodes each) | two columns stacked per node, bars that got faster `--success` / slower `--danger` (the Tuner's diff) | hide panel if `nodes[]` empty |
| **Per-step it/s** | overlaid lines, one per run (series color), legend; step-1 dimmed per line | same, overlaid | hide if <2 steps on all runs |
| **VRAM over time** | overlaid areas (low opacity) + one ceiling line **per distinct GPU** (don't draw a single ceiling if GPUs differ) | overlaid, shared ceiling | per-run line omitted if series empty |
| **Power / temp** | overlaid; power solid, temp dashed, one hue per run | same | hide the whole card if all runs report null power+temp (Apple/MPS) |

Chart honesty notes: when GPUs differ, VRAM ceilings differ — draw one labelled dashed ceiling per unique `totalVramMb`, never a shared one. When runs differ in step count, the per-step x-axis is "step index" (not normalized) and lines simply end where their steps end; we do not stretch a short run to match a long one.

### 4.5 Compare empty / edge states

| State | Body |
|---|---|
| 1 run only (arrived from dashboard with no prior match) | the single column + a muted panel "Pick more runs in History to compare" + **Back to History** |
| A chart has no data for any selected run | that card is hidden entirely (never an empty axis) |
| One run is needs-capture (`coreBenchmark == null`) | its column shows `—` across metric rows + a `No capture` tag under its header; other columns compare normally |

---

## 5. Export

Three exports, reachable from where their subject lives.

### 5.1 Single-run image (unchanged behavior, keep)
From the single-run dashboard: **Export image** renders the full dashboard SVG → PNG via the existing `createResultsPng`, saved auto-named **`comfy-benchmark-YYYY-MM-DD-HH-MM-SS.png`** into the benchmarks folder (keep the current naming and `exportResultsImage` IPC). No change requested; documented here for completeness.

### 5.2 Comparison image
From Compare: **Export image** renders the comparison (header context + the metrics table + the four charts) to a single PNG. Reuse the `exportResultsImage` IPC with base name **`comfy-benchmark-compare-YYYY-MM-DD-HH-MM-SS.png`**. Replaces today's `createBenchmarkComparisonSvg` (duration-only) with a composition built from the same `benchmarkCharts.ts` primitives the on-screen view uses, so the PNG matches the screen. Include the cross-workflow note text in the image when in cross-workflow mode (honesty travels with the artifact). Cap at 5 columns (same as on-screen).

### 5.3 Data export (CSV / JSON) — the new one
From History (selection) **or** Compare: **Export data ▾ → CSV / JSON**.

- **JSON:** an array of the selected runs' full normalized `CoreBenchmarkSummary` objects plus the top-level `PerformanceTestResultsSummary` wrapper fields (`createdAt`, `workflowName`, `instance`, `workspace`, durations, `hardware`). Lossless — this is the corpus format. File: `comfy-benchmarks-<N>-runs-YYYY-MM-DD.json`.
- **CSV:** one row per run, flat, spreadsheet-ready. File: `comfy-benchmarks-<N>-runs-YYYY-MM-DD.csv`. Numbers unformatted (raw units, no "GB"/"s" suffix in cells — units are in the header), tabular/decimal as captured, `` empty cell for not-measured (never `0`). Booleans `true`/`false`. UTF-8, comma-separated, quoted where needed.

**CSV columns (in order):**

```
session_id, created_at_iso, workflow_name, benchmark_id, benchmark_version,
gpu_model, backend, vram_total_mb, driver_version, comfyui_version,
median_sec_per_image, steady_state_it_per_s, avg_it_per_s,
vram_peak_mb, vram_peak_pct, energy_wh_per_image,
power_peak_w, power_limit_w, temp_peak_c, gpu_util_peak_pct,
sm_clock_mhz, mem_clock_mhz,
throttled, offloaded, vram_state,
weight_dtype, compute_dtype, attention_impl, cuda_version, cudnn_version, pytorch_version,
steps, sampler, scheduler, cfg, denoise, resolution_w, resolution_h, batch_size, image_count,
measured_runs, failed_runs,
run_duration_median_s, run_duration_fastest_s, run_duration_slowest_s, run_duration_avg_s, node_total_ms,
workspace_name, instance_name
```

Field → source map (defensive; `null` → empty cell):
- `median_sec_per_image` ← `summary.secPerImage` else `medianJobDurationSeconds / run.imageCount`.
- `steady_state_it_per_s` ← desktop-recomputed steady-state (per the task note: `sampling.steadyStateItPerS` may be null → recompute from `sampling.perStepItPerS` excluding step 1).
- `vram_peak_mb` ← `resources.peak.vramUsedMb`; `vram_peak_pct` ← peak/`device.totalVramMb`×100.
- `energy_wh_per_image` ← `summary.energyWhPerImage`.
- `power_peak_w`/`power_limit_w`/`temp_peak_c`/`gpu_util_peak_pct` ← `resources.peak.*`.
- config block ← `device.*`; workflow block ← `workflow.*`; durations ← top-level + `durations.nodeTotalMs`.

Why both formats: JSON for programmatic corpus/aggregation, CSV for the VFX lead who drops it into a spreadsheet to compare machines. Neither leaves the machine automatically — it is a user-initiated save (local-only, Goal 1).

---

## 6. Visual language

Identical token set to the single-run dashboard (`docs/design/html-v1/benchmark-results.html` tokens, which mirror `main.css`): plum neutral ramp, `--success #00cd72`, `--comfy-yellow #f2ff59` as the single per-card accent, `--danger #e05858`, Inter with tabular numerals, semantic tokens only, no `dark:` variant, no inline styles in production. Charts = inline SVG with real axes.

Accent discipline carried over: exactly **one** `--comfy-yellow` element per card. In History the yellow is the active sort/selected-row accent; in Compare charts the dominant op-timeline bar. Delta color (`--success`/`--danger`) is reserved for delta chips in Compare and appears nowhere in History (History values are all neutral — browsing is not judging).

Correction vs the v1 HTML reference: the VRAM verdict card there uses `--danger` on the big "97%" number and the editorializing headline. In v2 that number is neutral plum and the copy is factual (`31.7 GB of 32.6 GB (97%)`). Danger hue is delta-chip and abnormal-flag only.

---

## 7. Prioritized build list

**P0 — the honest corpus:**
1. Rework History rows to show rich at-a-glance metrics (sec/image, it/s, VRAM peak + %, energy, GPU, date) from `coreBenchmark`; `—` for not-measured; `⚑` flag for offloaded/throttled. (Backend: add `coreBenchmark` to the `PerformanceTestBenchmark` IPC shape so History doesn't walk flattened keys.)
2. Curated column toggle (replaces arbitrary-key picker) + the §3.3 sort menu, nulls-last.
3. Selection action bar + **Compare (N)** entry (2–5 runs) and **Export ▾** entry.
4. **Compare view**: columns, baseline selector, three-band metrics table, delta chips colored by outcome with ±2% dead-band, config-differs highlighting.
5. **Cross-workflow honesty** (§4.3): mode detection, `✕` on per-run deltas across different workflows, the neutral header note, per-GPU ceilings.
6. Op-timeline (side-by-side cross / diff A-B), VRAM-over-time overlay, per-step it/s overlay — inline SVG via `benchmarkCharts.ts`.
7. **Data export** CSV + JSON (§5.3) with the exact column schema.
8. Empty/needs-capture/no-match/load-error states for both views.

**P1 — same week:**
9. Power/temp overlay chart (hide when all-null).
10. Comparison **image** export (§5.2) matching the on-screen composition; keep single-run PNG + auto-name (§5.1).
11. Row `⋯` menu: Open / Run again / Rename / Reveal / Delete; **Run again** prefill flow.
12. Compare column reorder (carry over drag + Alt-arrow + a11y) and series-color legend consistency.

**P2 — later:**
13. Saved comparison sets ("my 4090-vs-5090 board") persisted locally.
14. Per-step it/s normalized-x toggle for same-step-count sets.
15. Quick-filter chips (e.g. "this GPU", "last 7 days") above the table.

---

## 8. Open questions (need Deep / backend)

1. **IPC enrichment.** Confirm adding typed `coreBenchmark` (and a recomputed `steadyStateItPerS`) to `PerformanceTestBenchmark` is acceptable, vs. History reading flattened `result.coreBenchmark.*` keys. (Recommend the former; small change, big ergonomics win.)
2. **Compare column cap.** Spec caps at 5 for legibility and export width. OK, or do power users need unlimited (with horizontal scroll)?
3. **Baseline default.** Leftmost/first-selected as baseline. For a GPU A/B, should we auto-pick the *newest* run as baseline (so deltas read "vs the thing I just ran")? Confirm.
4. **CSV not-measured encoding.** Empty cell (spec) vs an explicit sentinel. Empty is friendliest for spreadsheets but silent; confirm empty.
5. **sec/image across different image counts.** For same-workflow A/B where `imageCount` differs between runs, is sec/image still the right per-run headline, or fall back to total duration? (Spec keeps sec/image, which already normalizes by image count.)
6. **Run again fidelity.** Does Run support prefill from a historical run's exact config (seed, steps, sampler), or only re-selecting the workflow? Affects Flow B copy.
