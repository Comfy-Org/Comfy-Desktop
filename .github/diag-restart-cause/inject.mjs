// Temporary diagnostics: log the picker restart path and optionally widen the post-registration window. Not for merge.
import { readFileSync, writeFileSync } from 'node:fs'
const mode = process.argv[2] ?? 'log'
function edit(file, from, to) {
  const src = readFileSync(file, 'utf8')
  if (src.split(from).length !== 2) throw new Error(`expected exactly one match in ${file}: ${from.slice(0, 60)}`)
  writeFileSync(file, src.replace(from, to))
}
const index = 'src/main/index.ts'
edit(index, 'const boundInstallationId = parentEntry.installationId ?? parentEntry.previewInstallationId',
  "const boundInstallationId = parentEntry.installationId ?? parentEntry.previewInstallationId\n        console.log(`[diag-restart] guard target=${installationId} attached=${parentEntry.installationId} preview=${parentEntry.previewInstallationId} confirmed=${opts?.confirmed}`)")
edit(index, 'const cancelled = await ipc.cancelLaunching(installationId)',
  "const cancelled = await ipc.cancelLaunching(installationId)\n          console.log(`[diag-restart] cancelLaunching=${cancelled}`)")
edit(index, 'await ipc.stopRunning(installationId)',
  "await ipc.stopRunning(installationId)\n          console.log('[diag-restart] stopRunning done')")
edit(index, "          kind: 'picker-pick-install',\n          installationId,\n          isRestart: true\n        })",
  "          kind: 'picker-pick-install',\n          installationId,\n          isRestart: true\n        })\n        console.log('[diag-restart] relaunch sent to panel')")
const launch = 'src/main/lib/ipc/sessionActions/launch.ts'
const delay = mode === 'delay' ? "  await new Promise((r) => setTimeout(r, 2_000))\n" : ''
edit(launch, '  if (_onLaunch) {\n    _onLaunch({ port: launchCmd.port!, process: proc, installation: inst, mode })\n  }\n  return { ok: true, mode, port: launchCmd.port }',
  `  console.log('[diag-restart] session registered; onLaunch next')\n${delay}  if (_onLaunch) {\n    _onLaunch({ port: launchCmd.port!, process: proc, installation: inst, mode })\n  }\n  console.log('[diag-restart] launch handler returning')\n  return { ok: true, mode, port: launchCmd.port }`)
edit(launch, '  const launch = _beginLaunch(sessionId)', "  console.log(`[diag-restart] launch accepted ${sessionId}`)\n  const launch = _beginLaunch(sessionId)")
edit(launch, "    return { ok: false, message: i18n.t('errors.alreadyRunning') }", "    console.log(`[diag-restart] launch rejected: already running ${sessionId}`)\n    return { ok: false, message: i18n.t('errors.alreadyRunning') }")
edit(launch, "    return { ok: false, message: 'Another operation is already running for this installation.' }", "    console.log(`[diag-restart] launch rejected: operation in flight ${sessionId}`)\n    return { ok: false, message: 'Another operation is already running for this installation.' }")
const spec = 'e2e/core-beta-args-pill-restart.test.ts'
edit(spec, "    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 10_000, intervals: [100, 200] })\n    .toBe(false)\n",
  "    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 10_000, intervals: [100, 200] })\n    .toBe(false)\n" +
  "  await new Promise((resolve) => setTimeout(resolve, 4_000))\n" +
  "  const diagPanel = await ctx.panel.evaluate<string>(`document.body.innerText.replace(/\\\\s+/g, ' ').slice(0, 300)`).catch((e) => `panel read failed: ${e}`)\n" +
  "  const diagSession = await getRunningSessionSnapshot(ctx.app, INSTALL_ID).catch(() => 'read failed')\n" +
  "  console.log(`[diag-restart] 4s after confirm: busyConfirm=${diagPanel.includes('is currently in progress')} session=${JSON.stringify(diagSession)?.slice(0, 120)} panel=${diagPanel}`)\n")
console.log(`injected (${mode})`)
