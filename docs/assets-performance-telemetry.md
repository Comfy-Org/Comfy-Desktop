# Assets performance telemetry contract

Desktop compares boot duration and outcomes for launches with and without the Assets argument.
This is an observational comparison, not a controlled experiment or a measurement of causal effect.
It uses the existing ComfyUI boot lifecycle without adding Core instrumentation or asset metadata.

## Cohort contract

Each `comfy.desktop.comfyui.boot_started`, `boot_completed`, and `boot_failed` event carries:

- `assets_enabled`: whether the final launch arguments contain `--enable-assets`, including
  manual/source arguments.
- `core_beta_flags`: managed Core beta arguments applied after version and schema checks.
  Excludes manual arguments.
- `core_beta_opted_in`: resolved beta setting at launch; false if reading the setting failed.
- `core_version`: recorded Core release label from `coreSemver(inst)`, or null if unavailable.
  Not proof of the live checkout's version.
- `app_version`: Desktop version, attached centrally by `src/main/lib/telemetry.ts`.
- `boot_id`: per-launch join key shared by the lifecycle events. Retries reuse the same key.

`assets_enabled` describes an explicit launch argument, not service health. It does not detect a
future Core default that enables Assets without that argument, or prove that Assets initialized.
On schema-discovery failure, preserved manual arguments still count; arguments removed by a
successful schema check do not. Opting out suppresses grants, not manually supplied flags.

The false cohort mixes opted-out, ungranted, version-ineligible and schema-ineligible launches.
Segment by Core version and opt-in before comparing. Recorded release labels can lag a modified
checkout or describe a base tag rather than an exact release, so use known pinned releases when
interpreting a version comparison. These fields do not identify every reason a grant was withheld.

The normal telemetry consent gate still applies. No paths, filenames, asset names, prompts, model
metadata, or other user content are added. This follows the telemetry privacy rules documented in
[`src/main/lib/telemetry.ts`](../src/main/lib/telemetry.ts).

## PostHog queries

Boot duration by Desktop version, recorded Core version, beta opt-in and Assets argument:

```sql
SELECT
  properties.app_version AS desktop_version,
  properties.core_version AS core_version,
  properties.core_beta_opted_in AS beta_opted_in,
  properties.assets_enabled AS assets_enabled,
  count() AS completed_boots,
  round(avg(toFloat(properties.boot_time_ms)), 0) AS mean_boot_ms,
  round(quantile(0.5)(toFloat(properties.boot_time_ms)), 0) AS p50_boot_ms,
  round(quantile(0.95)(toFloat(properties.boot_time_ms)), 0) AS p95_boot_ms
FROM events
WHERE event = 'comfy.desktop.comfyui.boot_completed'
  AND timestamp >= now() - INTERVAL 14 DAY
  AND properties.assets_enabled IS NOT NULL
GROUP BY desktop_version, core_version, beta_opted_in, assets_enabled
ORDER BY desktop_version DESC, core_version DESC, beta_opted_in DESC, assets_enabled DESC
```

Boot outcome with the same segmentation. Distinct boot IDs prevent retries from inflating counts:

```sql
SELECT
  properties.app_version AS desktop_version,
  properties.core_version AS core_version,
  properties.core_beta_opted_in AS beta_opted_in,
  properties.assets_enabled AS assets_enabled,
  uniqIf(properties.boot_id, event = 'comfy.desktop.comfyui.boot_started') AS boots_started,
  uniqIf(properties.boot_id, event = 'comfy.desktop.comfyui.boot_completed') AS boots_completed,
  uniqIf(properties.boot_id, event = 'comfy.desktop.comfyui.boot_failed') AS boots_failed,
  round(100 * boots_completed / nullIf(boots_started, 0), 2) AS success_rate_pct
FROM events
WHERE event IN (
  'comfy.desktop.comfyui.boot_started',
  'comfy.desktop.comfyui.boot_completed',
  'comfy.desktop.comfyui.boot_failed'
)
  AND timestamp >= now() - INTERVAL 14 DAY
  AND properties.assets_enabled IS NOT NULL
GROUP BY desktop_version, core_version, beta_opted_in, assets_enabled
ORDER BY desktop_version DESC, core_version DESC, beta_opted_in DESC, assets_enabled DESC
```

Use the first query as a duration trend and the second as an outcome table. Compare Assets cohorts
within the same Desktop version, Core version and opt-in segment. Keep unknown Core versions
separate. Rows predating these properties are excluded rather than counted as Assets off.

Report cohort counts alongside durations and rates. Hardware, installation history, manual flags
and eligibility can still differ within a segment; do not call a difference an Assets-caused
regression. Recent launches may lack a terminal event, and cancellations are not boot failures.
The rolling window can also split a launch's start and completion across its boundary.

## Glossary

- **Cohort:** launches grouped by the recorded properties above.
- **Grant:** a managed beta argument authorized by the remote flag and local launch checks.
- **Core:** the ComfyUI Python process launched by Desktop.
- **Schema:** the supported command-line arguments discovered from Core.
- **PostHog / HogQL:** the event analytics service and its SQL query language.
- **p50 / p95:** the 50th and 95th percentiles of completed-boot duration.
