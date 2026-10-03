# Assets performance telemetry contract

Desktop compares boot duration and outcomes for launches with and without the Assets argument.
This is an observational comparison, not a controlled experiment or a measurement of causal effect.
It uses the existing ComfyUI boot lifecycle without adding Core instrumentation or asset metadata.

## Cohort contract

Each `comfy.desktop.comfyui.boot_started`, `boot_completed`, and `boot_failed` event carries:

- `assets_enabled`: whether the final launch arguments contain `--enable-assets`, including
  manual/source arguments.
- `core_beta_flags`: managed Core beta arguments applied after version or commit-range and
  schema checks. Excludes manual arguments.
- `core_beta_opted_in`: resolved beta setting at launch; false if reading the setting failed.
- `core_version`: recorded Core release label from `coreSemver(inst)`, or null if unavailable.
  Not proof of the live checkout's version.
- `core_commit`: full SHA of the Core commit launched: the live checkout's HEAD, or the recorded
  commit on an install with no git checkout. Null when a git checkout could not be read. This is
  the identifier to group or order by; two latest-channel installs past the same tag share a
  `core_version` but not a `core_commit`.
- `core_version_label`: display form of the recorded version, e.g. `v0.37.0+15`. For reading,
  not for sorting or gating.
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

The normal telemetry consent gate still applies. No raw paths, filenames, asset names, prompts,
model metadata, or other user content are added. The database location fields below carry only
hashes and fixed labels. This follows the telemetry privacy rules documented in
[`src/main/lib/telemetry.ts`](../src/main/lib/telemetry.ts).

## Database location fields

`boot_started` also says where the launch keeps its asset database, user directory and base
directory, so two installs sharing one database can be told apart
(`src/main/lib/dbLocationTelemetry.ts`). They are computed only when telemetry consent is granted.

- `db_path_hash`, `user_dir_hash`, `base_dir_hash`: a SHA-256 of the resolved, normalised path,
  truncated to 16 hex characters, or null. Equal hashes on one machine mean the same location; across machines they only mean the same path spelling. The hash is
  one-way but unkeyed: someone with telemetry access could confirm a guessed path, such as a
  username and folder layout, by hashing it. That trade-off was chosen over keeping a per-user
  key file.
- `db_path_rel`, `user_dir_rel`, `base_dir_rel`: the location relative to a folder Desktop knows,
  built only from placeholders (`<this-install>`, `<install-root>`, `<install>`, `<legacy-root>`)
  and fixed names (`ComfyUI`, `user`, `comfyui.db`), e.g.
  `<this-install>/ComfyUI/user/comfyui.db`. An install folder is always `<install>`, since it is
  named after the user's install name. Any other location is `outside_default`; null when the
  hash is null.
- `db_url_source`: `install_local`, `adopted_legacy`, `user_override` or `unknown`. Derived from
  the launch arguments alone.
- `db_location_status`: `ok`; or `timeout` / `error`, in which case only `db_url_source` is
  sent alongside it. A launch waits at most 500ms for the location, and lookups run one at a
  time, so a launch queued behind a stalled lookup also reports `timeout`.

A field is null rather than a guess when the location cannot be determined reliably, for example
when the core's default database location depends on a version that cannot be established.

## Asset event-log fields

Core's assets system writes `[assets-event] <event> key=value ...` lines, which Desktop forwards as
`comfy.desktop.comfyui.assets.<event>` (`src/main/lib/assetsTap.ts`). Events and string fields are
a closed vocabulary mirrored from Core's `app/assets/event_log.py`; adding one needs a change on
both sides. Numeric and boolean metrics can skip the Desktop change by following a naming
convention:

| Field name                   | Value forwarded        |
| ---------------------------- | ---------------------- |
| `*_ms`, `*_count`, `*_bytes` | integer, 0 to 2^53 - 1 |
| `*_pct`                      | integer, 0 to 100      |
| `*_enabled`, `is_*`, `has_*` | `true` / `false`       |

- Names use lowercase letters and underscores only. A digit anywhere in a field name (`p95_ms`)
  drops the WHOLE line, not just that field. Names over 48 characters are omitted. Suffixes are
  checked before prefixes, so `is_cache_hit_pct` is a percentage.
- Fractions are not forwarded; send an integer.
- A value of the wrong type or range is omitted, and the rest of the event still forwards.
- Names Desktop attaches to every event itself (such as `platform`, `is_packaged` or
  `telemetry_enabled`) are never forwarded.
- The same convention name twice on one line drops the line, reserved names included.
- At most 64 distinct convention names are forwarded per ComfyUI launch session. Later new names
  are silently omitted, and names already forwarded keep forwarding.

**Accepted risk: the field name is free text.** The value can only be a number or a boolean,
but the name is chosen by whoever writes the line. A convention-shaped name becomes a PostHog
property key, and a Datadog action-context key on the failure events mirrored to Datadog. So
anything that can print to Core's stdout, such as a custom node, can put up to 48 lowercase
characters into a key, at most 64 distinct names per launch session. This is accepted: such code can
already send arbitrary data over the network directly. Core's own emitter only sends names from
its reviewed allowlist.

The shared line fixture (`src/main/lib/__fixtures__/assets-event-lines.txt`, a byte-identical copy
of Core's) gains a convention example when Core next changes its copy.

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
