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

if (mode !== 'none') {
  edit('src/main/index.ts', '    registerDownloadHandlers()\n',
    "    app.on('web-contents-created', (_e, wc) => {\n      ;(wc as unknown as { on: (e: string, l: (...a: unknown[]) => void) => void }).on('console-message', (...a: unknown[]) => {\n        const m = typeof a[2] === 'string' ? a[2] : (a[0] as { message?: string } | undefined)?.message\n        if (typeof m === 'string' && m.includes('[diag-')) console.log(`[renderer] ${m}`)\n      })\n    })\n    registerDownloadHandlers()\n")
  edit('src/renderer/src/composables/useDeepLinkRouter.ts', "        if (payload.kind === 'picker-pick-install') {\n          await opts.bootstrapReady",
    "        if (payload.kind === 'picker-pick-install') {\n          console.log(`[diag-pick] router got pick ${JSON.stringify(payload)}`)\n          await opts.bootstrapReady\n          console.log('[diag-pick] router bootstrapReady')")
  edit('src/renderer/src/composables/useDeepLinkRouter.ts', '          const inst = installationStore.getById(id)\n          if (!inst) {\n            // Boot restore',
    '          const inst = installationStore.getById(id)\n          console.log(`[diag-pick] router inst=${!!inst}`)\n          if (!inst) {\n            // Boot restore')
  edit('src/renderer/src/panel/PanelApp.vue', '  pickInstallFromPicker: async (inst, pickOpts) => {',
    '  pickInstallFromPicker: async (inst, pickOpts) => {\n    console.log(`[diag-pick] panel pick hostInstall=${installationId} opts=${JSON.stringify(pickOpts)}`)')
  edit('src/renderer/src/panel/useChooserHandoff.ts', '    if (sessionStore.isRunning(installation.id)) {\n      // Focus the running window and leave the chooser host alive.',
    '    console.log(`[diag-pick] performChooserLaunch running=${sessionStore.isRunning(installation.id)}`)\n    if (sessionStore.isRunning(installation.id)) {\n      // Focus the running window and leave the chooser host alive.')
  edit('src/renderer/src/composables/useListAction.ts', '    // Busy guard runs for every action so none can race an in-flight op.\n    if (!(await actionGuard.checkBeforeAction(inst.id, action.label))) return',
    '    // Busy guard runs for every action so none can race an in-flight op.\n    console.log(`[diag-pick] executeAction ${action.id} enabled=${action.enabled}`)\n    const diagBusyOk = await actionGuard.checkBeforeAction(inst.id, action.label)\n    console.log(`[diag-pick] busy guard passed=${diagBusyOk}`)\n    if (!diagBusyOk) return')
  edit('src/renderer/src/composables/useListAction.ts', '      if (!canLaunch) {',
    '      console.log(`[diag-pick] local instance guard canLaunch=${canLaunch}`)\n      if (!canLaunch) {')
  edit('src/renderer/src/composables/useActionGuard.ts', '    if (isBusy) {',
    '    console.log(`[diag-pick] busy=${isBusy} launching=${sessionStore.isLaunching(installationId)} activeSession=${!!activeSession} running=${sessionStore.isRunning(installationId)} progress=${JSON.stringify(progressStore.getProgressInfo(installationId))}`)\n    if (isBusy) {')
}
console.log(`injected (${mode})`)
