import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations, hasActiveOperation, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let legacyBasePath: string
let launchStartedAt = 0
let launchReturnedAt = 0

interface FileTimes {
  birth: number
  modified: number
  changed: number
  size: number
}

async function fileTimes(filePath: string): Promise<FileTimes | null> {
  try {
    const s = await stat(filePath)
    return { birth: s.birthtimeMs, modified: s.mtimeMs, changed: s.ctimeMs, size: s.size }
  } catch {
    return null
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

interface Probe {
  state: unknown
  sources: string[]
}

async function probe(): Promise<Probe> {
  return {
    state: await ctx.panel.evaluate<unknown>('window.api.getFirstUseState()'),
    sources: await ctx.panel.evaluate<string[]>(
      'window.api.getInstallations().then((all) => all.map((i) => i.sourceId))'
    )
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(
    process.platform !== 'win32',
    'Legacy Desktop detection sandbox only works on Windows (APPDATA-based)'
  )

  legacyBasePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-first-use-migrate-e2e-'))
  await mkdir(path.join(legacyBasePath, 'models'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'user'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'input'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'output'), { recursive: true })
  await mkdir(path.join(legacyBasePath, '.venv'), { recursive: true })

  launchStartedAt = Date.now()
  ctx = await launchApp({
    async onSetup({ homeDir }) {
      const desktopConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'ComfyUI')
      await mkdir(desktopConfigDir, { recursive: true })
      await writeFile(
        path.join(desktopConfigDir, 'config.json'),
        JSON.stringify({ basePath: legacyBasePath })
      )
    }
  })
  launchReturnedAt = Date.now()
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (legacyBasePath) await rm(legacyBasePath, { recursive: true, force: true })
})

test('cold start with legacy desktop offers to migrate it on Set up, ticked by default @lifecycle', async () => {
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  const setupVisibleAt = Date.now()
  const rowAtFirstLook = await ctx.panel.isVisible('[data-testid="setup-migrate-existing"]')
  let rowAfterMs: number | null = rowAtFirstLook ? 0 : null
  const waitStartedAt = Date.now()
  while (rowAfterMs === null && Date.now() - waitStartedAt < 8_000) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (await ctx.panel.isVisible('[data-testid="setup-migrate-existing"]')) {
      rowAfterMs = Date.now() - waitStartedAt
    }
  }
  const last = await probe()
  const navigation = await ctx.panel.evaluate<{
    origin: number
    domContentLoaded: number | null
    load: number | null
  }>(`(() => {
    const entry = performance.getEntriesByType('navigation')[0]
    return {
      origin: performance.timeOrigin,
      domContentLoaded: entry ? entry.domContentLoadedEventEnd : null,
      load: entry ? entry.loadEventEnd : null
    }
  })()`)
  const paths = await ctx.app.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    logs: app.getPath('logs')
  }))
  const listPath = path.join(paths.userData, 'installations.json')
  const list = await fileTimes(listPath)
  const backup = await fileTimes(`${listPath}.bak`)
  const temp = await fileTimes(`${listPath}.tmp`)
  const listText = await readText(listPath)
  const backupText = await readText(`${listPath}.bak`)
  const sourcesIn = (text: string | null): string[] | null => {
    if (text === null) return null
    try {
      return (JSON.parse(text) as Array<{ sourceId: string }>).map((entry) => entry.sourceId)
    } catch {
      return ['unparseable']
    }
  }
  const appLog = (await readText(path.join(paths.logs, 'app.log'))) ?? ''
  const logLines = appLog.split('\n').filter((line) => line.trim() !== '')
  const notable = logLines.filter((line) =>
    /\[warn\]|\[error\]|Skipped|EPERM|EBUSY|EACCES|installations/i.test(line)
  )
  const rel = (value: number | null | undefined): number | null =>
    typeof value === 'number' ? Math.round(value - launchStartedAt) : null
  console.log(
    `[migrate-diag] ${JSON.stringify({
      rowAtFirstLook,
      rowAfterMs,
      launchReturned: rel(launchReturnedAt),
      setupVisible: rel(setupVisibleAt),
      panelOrigin: rel(navigation.origin),
      panelDomContentLoaded:
        navigation.domContentLoaded === null
          ? null
          : rel(navigation.origin + navigation.domContentLoaded),
      listBirth: rel(list?.birth),
      listModified: rel(list?.modified),
      listChanged: rel(list?.changed),
      backupBirth: rel(backup?.birth),
      backupModified: rel(backup?.modified),
      backupChanged: rel(backup?.changed),
      tempLeftBehind: temp !== null,
      stateAfterWait: last.state,
      sourcesAfterWait: last.sources,
      listOnDisk: sourcesIn(listText),
      backupOnDisk: sourcesIn(backupText),
      launchStartedIso: new Date(launchStartedAt).toISOString(),
      logLineCount: logLines.length,
      logHead: logLines.slice(0, 8).map((line) => line.slice(0, 110)),
      notable: notable.slice(0, 30)
    })}`
  )
  if (rowAfterMs === null || rowAfterMs > 5_000) {
    console.log(`[migrate-diag-log] ${JSON.stringify(logLines.slice(0, 120))}`)
  }
  expect(rowAfterMs, 'migrate row never appeared on Set up').not.toBeNull()
  expect(rowAfterMs!, 'migrate row took longer than the spec allows').toBeLessThanOrEqual(5_000)
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector('[data-testid="setup-migrate-existing"] [role="checkbox"]')?.getAttribute('aria-checked') === 'true'`
    )
  ).toBe(true)
  expect(await ctx.panel.click('[data-testid="setup-consent-tos"] [role="checkbox"]')).toBe(true)
  expect(
    await ctx.panel.evaluate<string>(
      `document.querySelector('[data-testid="setup-install"]')?.textContent?.trim() ?? ''`
    )
  ).toBe('Migrate')
})

test('Migrate on Set up opens MigrateConfirmTakeover (takeover surface) @lifecycle', async () => {
  await resetIpcInvocations(ctx.app, 'run-action')
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.panel.click('[data-testid="setup-install"]')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-confirm"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-cancel"]')

  await ctx.panel.waitFor(
    async () =>
      ctx.panel.evaluate<boolean>(
        `!document.querySelector('[data-testid="migrate-takeover-confirm"]').disabled`
      ),
    { timeout: 15_000, message: 'migrate-takeover Confirm never became enabled (preview stalled)' }
  )

  expect(await ctx.panel.click('[data-testid="migrate-takeover-confirm"]')).toBe(true)

  type RunActionCall = { installationId: string; actionId: string }
  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionCall[]
        return calls.some((c) => c.actionId === 'migrate-to-standalone')
      },
      { timeout: 15_000, intervals: [200, 500] }
    )
    .toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertCancel), { timeout: 60_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertCancel))).toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 30_000 })

  const legacyInstalls = await ctx.panel.evaluate<Array<{ id: string; sourceId: string }>>(
    `window.api.getInstallations()`
  )
  const legacy = legacyInstalls.find((i) => i.sourceId === 'desktop')
  expect(legacy, 'legacy desktop record must survive a failed adoption').toBeDefined()
  await expect
    .poll(() => hasActiveOperation(ctx.app, legacy!.id), {
      timeout: 30_000,
      intervals: [500, 1_000]
    })
    .toBe(false)

  const modeCalls = (await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')) as Array<{
    mode: string
  }>
  const modes = modeCalls.map((c) => c.mode)
  expect(modes, 'chain-migrate should re-assert post-consent after dismiss').toContain(
    'post-consent'
  )
})
