# Assets performance telemetry contract

Desktop measures the performance effect of Core Assets at the Desktop/Core launch boundary. The
comparison uses the existing ComfyUI boot lifecycle, which is emitted for both Assets-enabled and
Assets-disabled launches. It does not add instrumentation inside Core or collect asset metadata.

## Cohort contract

Each `comfy.desktop.comfyui.boot_started`, `boot_completed`, and `boot_failed` event carries:

| Property          | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `assets_enabled`  | Whether `--enable-assets` was actually applied to this launch after Desktop's version and Core-schema gates. |
| `core_beta_flags` | All Core beta arguments actually applied to this launch.                                                     |
| `app_version`     | Desktop version, attached centrally by `src/main/lib/telemetry.ts`.                                          |
| `boot_id`         | Per-launch join key shared by the lifecycle events. Retries reuse the same key.                              |

`assets_enabled = false` means the running launch did not receive the Assets argument, including an
opted-out launch or one whose Core version/schema did not support the grant. This is intentional:
the comparison is actual runtime state, not user intent.

The normal telemetry consent gate still applies. No paths, filenames, asset names, prompts, model
metadata, or other user content are added. This follows the telemetry privacy rules documented in
`src/main/lib/telemetry.ts` and ADR-029.

## PostHog queries

Boot duration by Desktop version and applied Assets state:

```sql
SELECT
  properties.app_version AS desktop_version,
  properties.assets_enabled AS assets_enabled,
  count() AS completed_boots,
  round(avg(toFloat(properties.boot_time_ms)), 0) AS mean_boot_ms,
  round(quantile(0.5)(toFloat(properties.boot_time_ms)), 0) AS p50_boot_ms,
  round(quantile(0.95)(toFloat(properties.boot_time_ms)), 0) AS p95_boot_ms
FROM events
WHERE event = 'comfy.desktop.comfyui.boot_completed'
  AND timestamp >= now() - INTERVAL 14 DAY
GROUP BY desktop_version, assets_enabled
ORDER BY desktop_version DESC, assets_enabled DESC
```

Boot outcome by Desktop version and applied Assets state:

```sql
SELECT
  properties.app_version AS desktop_version,
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
GROUP BY desktop_version, assets_enabled
ORDER BY desktop_version DESC, assets_enabled DESC
```

Use the first query as a trend grouped by `assets_enabled`; use the second as a table. Do not compare
Desktop versions across cohorts when either cohort has too few completed boots to be representative.
