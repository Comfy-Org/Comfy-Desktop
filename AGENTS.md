This repository has a zero tolerance policy for flaky tests.

## ComfyUI-Manager is v4 (not the legacy v3 layout)

Installs launched by this app run **Manager v4**: the `comfyui_manager` Python package inside the standalone env, enabled through ComfyUI's `--enable-manager` flag. Do not reason about Manager from the v3 codebase.

- **Source of truth: the `manager-v4` branch** of Comfy-Org/ComfyUI-Manager. The `main` branch (legacy `glob/manager_server.py` layout) does NOT describe what desktop ships - reading it gives wrong answers about security gates, endpoints, and config. A workspace checkout of ComfyUI-Manager is typically on `main`; use `git show origin/manager-v4:<path>` or check out the branch.
- **Per-install config** lives at `<install>/ComfyUI/user/__manager/config.ini`, `[default]` section. The launcher reconciles per-install settings into it on launch (see `src/main/lib/managerConfig.ts`).
- **v4 security model** (differs from v3):
  - Risk levels are subdivided: `block` / `high+` / `high` / `middle+` / `middle`.
  - `network_mode` accepts `public | private | offline | personal_cloud`.
  - With a non-loopback `--listen`, `middle+` actions (e.g. installing node packs) are denied at EVERY `security_level` unless `network_mode = personal_cloud`; `high+` additionally requires `security_level = weak`.
  - `allow_git_url_install` / `allow_pip_install` are independent config flags, gated by the same network-position rule.
- **API is v2**: endpoints live under `/api/v2/...` (e.g. the lifecycle test probes `POST /api/v2/snapshot/remove`).