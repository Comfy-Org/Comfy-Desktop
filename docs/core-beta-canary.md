# Core beta feature canary

Desktop evaluates the PostHog feature flag `desktop_core_beta_features` once at
application boot. The evaluation uses Desktop's installation-stable ID, so a
percentage rollout remains stable across launches and sign-in changes. It is an
operational configuration read and still works when analytics consent is
undecided or denied.

Configure the enabled boolean value (or a multivariate variant) with this JSON
payload:

```json
{
  "flags": ["enable-assets"]
}
```

The entries are Core CLI flag names without `--`. Before every local Core
launch, Desktop discovers that installed Core version's `--help` schema and
injects only requested switches that are:

- present in that Core version;
- boolean `enable-*` switches; and
- classified as Core feature switches by Desktop.

Unsupported or malformed entries are ignored. A disabled flag, missing
payload, evaluation timeout, or PostHog error injects nothing. Remote config
cannot set value-taking arguments or alter paths, networking, Manager controls,
or other launch settings. User launch arguments follow canary arguments, so a
future explicit `--disable-*` choice remains authoritative.

The current rollout can therefore enable the assets system with
`{"flags":["enable-assets"]}`. Updating the flag or payload takes effect after
Desktop restarts; Core must then be relaunched.

Targeting is installation-based. Percentage rollouts work directly. Targeting
by a signed-in user's email or PostHog person properties is not supported at
this pre-Core-launch boundary because Desktop does not yet have a verified
authenticated identity when the launch decision is required.

Desktop records Core stdout and stderr in `<install>/logs/comfyui.log` and keeps
rotated prior logs in the same directory. Desktop's console also includes a
`[core-canary]` line listing the switches injected for a launch.
