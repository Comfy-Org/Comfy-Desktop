# PostHog telemetry events

Repository inventory based on commit `379dc684`.

> [!NOTE]
> Unpackaged development builds (`pnpm dev`) do not send PostHog writes. The
> telemetry initializer sets `suppressEmit = true` when `isPackaged` is false.

PostHog writes are centralized in `src/main/lib/telemetry.ts`. Renderer events
are forwarded to it through `src/main/lib/ipc/registerTelemetryHandlers.ts`.

## Fixed event names

### PostHog-native

- `$exception`
- `$identify`

`comfy.desktop.exception.error` is an internal rate-limit and Datadog name;
PostHog receives `$exception`.

### Authentication and identity

- `app:user_logged_in`
- `comfy.desktop.auth.sign_in_started`
- `comfy.desktop.auth.sign_in_failed`
- `comfy.desktop.identity.login_attributed`
- `comfy.desktop.identity.pending_consensus_expired`
- `comfy.desktop.person.set`

### Application and sessions

- `comfy.desktop.app.first_launch`
- `comfy.desktop.app.language_resolved`
- `comfy.desktop.session.started`
- `comfy.desktop.session.ended`
- `comfy.desktop.session.instance_started`
- `comfy.desktop.session.installation_started`
- `comfy.desktop.session.installs_inventory`
- `comfy.desktop.session.snapshot_history`
- `comfy.desktop.session.storage_detected`
- `comfy.desktop.session.system_info`

### App updates

- `comfy.desktop.app_update.available`
- `comfy.desktop.app_update.checked`
- `comfy.desktop.app_update.download_started`
- `comfy.desktop.app_update.download_complete`
- `comfy.desktop.app_update.error`
- `comfy.desktop.app_update.ignored_not_newer`
- `comfy.desktop.app_update.install_triggered`
- `comfy.desktop.app_update.startup_install`
- `comfy.desktop.app_update.startup_install_skipped`
- `comfy.desktop.app_update.startup_install_backstop_recovered`

### First-use funnel

- `comfy.desktop.first_use.abandoned`
- `comfy.desktop.first_use.completed`
- `comfy.desktop.first_use.consent_decision`
- `comfy.desktop.first_use.fork_chosen`
- `comfy.desktop.first_use.local_branch_chosen`
- `comfy.desktop.first_use.mirrors_chosen`
- `comfy.desktop.first_use.step_viewed`
- `comfy.desktop.first_use.why_cloud_opened`
- `comfy.desktop.first_use.why_cloud_action`

### Installation

- `comfy.desktop.install.completed`
- `comfy.desktop.install.disk_warning.response`
- `comfy.desktop.install.dispatched`
- `comfy.desktop.install.express.started`
- `comfy.desktop.install.express.fallback`
- `comfy.desktop.install.flow.opened`
- `comfy.desktop.install.guardrail.blocked`
- `comfy.desktop.install.method.selected`
- `comfy.desktop.install.not_started`
- `comfy.desktop.install.phase`
- `comfy.desktop.install.showcase.cloud_open`
- `comfy.desktop.install.validation`
- `comfy.desktop.install.variant.selected`

### ComfyUI lifecycle

- `comfy.desktop.comfyui.accelerator_detected`
- `comfy.desktop.comfyui.boot_started`
- `comfy.desktop.comfyui.boot_completed`
- `comfy.desktop.comfyui.boot_failed`
- `comfy.desktop.comfyui.boot_log`
- `comfy.desktop.comfyui.boot_phase`
- `comfy.desktop.comfyui.canvas_rendered`
- `comfy.desktop.comfyui.exited`
- `comfy.desktop.comfyui.model_usage_summary`
- `comfy.desktop.comfyui.update.applied`

### Instances, actions, and navigation

- `comfy.desktop.action.invoked`
- `comfy.desktop.action.result`
- `comfy.desktop.op.result`
- `comfy.desktop.instance.opened_new_window`
- `comfy.desktop.instance.relaunched_after_crash`
- `comfy.desktop.instance.return_to_dashboard`
- `comfy.desktop.instance.switched`
- `comfy.desktop.view.opened`
- `comfy.desktop.workspace.refresh`
- `comfy.desktop.zoom.reset`
- `comfy.desktop.title_menu.item_clicked`

### Execution and models

- `comfy.desktop.execution.error`
- `comfy.desktop.execution.first_completed`
- `comfy.desktop.execution.session_summary`
- `comfy.desktop.model_download.started`
- `comfy.desktop.model_download.result`
- `comfy.desktop.node.installed`

### Snapshots and migration

- `comfy.desktop.snapshot.created`
- `comfy.desktop.snapshot.flow`
- `comfy.desktop.snapshot.imported`
- `comfy.desktop.snapshot.shared`
- `comfy.desktop.migrate.restore_snapshot.error`
- `comfy.desktop.recovery.failed`
- `comfy.desktop.recovery.rolled_back`
- `comfy.desktop.track_existing.saved`

### Templates

- `comfy.desktop.template.download.skipped`
- `comfy.desktop.template.install_confirmed`
- `comfy.desktop.template.picker_shown`
- `comfy.desktop.template.selected`
- `comfy.desktop.template.skipped`

### Settings

- `comfy.desktop.args.builder.opened`
- `comfy.desktop.args.changed`
- `comfy.desktop.settings.changed`

### Billing and cloud

- `comfy.desktop.billing.checkout_opened`
- `comfy.desktop.billing.checkout_returned`
- `comfy.desktop.billing.tier_changed`
- `comfy.desktop.cloud.entered`
- `comfy.desktop.dashboard.why_cloud_opened`
- `comfy.desktop.dashboard.why_cloud_action`

### Feedback and experiments

- `comfy.desktop.feedback.opened`
- `comfy.desktop.feedback.submitted`
- `comfy.desktop.experiment.exposed`

### Git and environment repair

- `comfy.desktop.git.system_fallback`
- `comfy.desktop.pygit2.circuit_broken`
- `comfy.desktop.pygit2.probe_failed`
- `comfy.desktop.pygit2.repair_attempted`
- `comfy.desktop.manager.config_seed_failed`
- `comfy.desktop.torch_repair.detected`
- `comfy.desktop.torch_repair.failed`
- `comfy.desktop.torch_repair.recovery_failed`
- `comfy.desktop.torch_repair.succeeded`

### Desktop adoption

- `comfy.desktop.adopt.started`
- `comfy.desktop.adopt.succeeded`

### MCP

- `comfy.desktop.mcp.sidebar_opened`
- `comfy.desktop.mcp.docs_opened`
- `comfy.desktop.mcp.option_selected`
- `comfy.desktop.mcp.panel_dismissed`
- `comfy.desktop.mcp.path_selected`
- `comfy.desktop.mcp.snippet_copied`
- `comfy.desktop.mcp.terminal_opened`

### Telemetry safeguards

- `comfy.desktop.telemetry.rate_limited`
- `comfy.desktop.telemetry.session_cap_hit`

## Generated step events

`trackedStep()` in `src/main/lib/telemetry.ts` generates `.start` and `.end`
events for every base below. Therefore `x.{start,end}` represents two exact
event names: `x.start` and `x.end`.

### Adoption

- `comfy.desktop.adopt.allocate.{start,end}`
- `comfy.desktop.adopt.backup.{start,end}`
- `comfy.desktop.adopt.carry_settings.{start,end}`
- `comfy.desktop.adopt.detect.{start,end}`
- `comfy.desktop.adopt.find_existing.{start,end}`
- `comfy.desktop.adopt.register.{start,end}`
- `comfy.desktop.adopt.requirements.{start,end}`
- `comfy.desktop.adopt.requirements_reconcile.{start,end}`
- `comfy.desktop.adopt.snapshot.{start,end}`
- `comfy.desktop.adopt.source.{start,end}`
- `comfy.desktop.adopt.tcc.{start,end}`
- `comfy.desktop.adopt.validate_venv.{start,end}`

### Installation and migration

- `comfy.desktop.install.post_install.{start,end}`
- `comfy.desktop.install.standalone.{start,end}`
- `comfy.desktop.migrate.allocate.{start,end}`
- `comfy.desktop.migrate.finalize.{start,end}`
- `comfy.desktop.migrate.flow.{start,end}`
- `comfy.desktop.migrate.input.{start,end}`
- `comfy.desktop.migrate.models.{start,end}`
- `comfy.desktop.migrate.output.{start,end}`
- `comfy.desktop.migrate.prepare_target.{start,end}`
- `comfy.desktop.migrate.resolve_target.{start,end}`
- `comfy.desktop.migrate.restore_snapshot.{start,end}`
- `comfy.desktop.migrate.source_preflight.{start,end}`
- `comfy.desktop.migrate.user_files.{start,end}`

### Snapshot restoration

- `comfy.desktop.snapshot.restore_comfyui_version.{start,end}`
- `comfy.desktop.snapshot.restore_custom_nodes.{start,end}`
- `comfy.desktop.snapshot.restore_pip_packages.{start,end}`

### Reachable generated errors

Canonical flow scopes suppress duplicate inner errors. The current production
call graph can emit these generated failures:

- `comfy.desktop.adopt.requirements_reconcile.error`
- `comfy.desktop.migrate.flow.error`
- `comfy.desktop.migrate.restore_snapshot.error`
- `comfy.desktop.snapshot.restore_comfyui_version.error`
- `comfy.desktop.snapshot.restore_custom_nodes.error`
- `comfy.desktop.snapshot.restore_pip_packages.error`

## Open-ended bridge caveat

The hosted ComfyUI bridge accepts an arbitrary `event: string` through
`src/types/comfyDesktopBridge.ts`. Code loaded remotely inside ComfyUI can
therefore submit additional names that are not present in this repository.
This inventory is exhaustive for event names defined by this repository, but
cannot enumerate events originating from external hosted code.
