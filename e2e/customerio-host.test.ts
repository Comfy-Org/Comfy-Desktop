import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { _electron, expect, test as base, type ElectronApplication } from '@playwright/test'
import type {} from './support/customerIoHostMain'

const test = base.extend<{ host: ElectronApplication }>({
  // Playwright requires destructuring even when the fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  host: async ({}, use) => withHost(use)
})

// A failing lifecycle must fail CI, even when the shared project enables retries.
test.describe.configure({ retries: 0 })

test('native Desktop views hand messaging to local ComfyUI and revoke consent @macos @windows @linux', async ({
  host: app
}) => {
  await app.evaluate(() => customerIoHostFixture.waitForIdentity(0))
  expect(await app.evaluate(() => customerIoHostFixture.messageCount('launcher'))).toBe(0)
  await app.evaluate(() => customerIoHostFixture.resolveIdentity(0, 'launcher-firebase-user'))
  await app.evaluate(() => customerIoHostFixture.waitForMessage('launcher'))

  const before = await app.evaluate(() => customerIoHostFixture.snapshot())
  expect(before.visible).toEqual(['launcher'])
  expect(before.focused).toBe(true)
  expect(before.publications.at(-1)?.session).toMatchObject({
    userId: 'launcher-firebase-user',
    page: 'desktop/launcher'
  })
  await app.evaluate(() => customerIoHostFixture.switchTo('comfyui'))
  await app.evaluate(() => customerIoHostFixture.waitForMessage('comfyui'))
  await app.evaluate(() => customerIoHostFixture.waitForClear('launcher'))
  const after = await app.evaluate(() => customerIoHostFixture.snapshot())
  expect(after.visible).toEqual(['comfyui'])
  expect(after.publications.slice(before.publications.length)).toMatchObject([
    { surface: 'launcher', session: null },
    { surface: 'comfyui', session: { userId: 'local-firebase-user', page: 'desktop/comfyui' } }
  ])
  expect(after.publications.every(({ granted }) => granted.length <= 1)).toBe(true)
  expect(
    after.publications.every(
      ({ surface, session, visible }) => !session || visible.includes(surface)
    )
  ).toBe(true)
  expect(after.queueUsers).toEqual(
    expect.arrayContaining(['launcher-firebase-user', 'local-firebase-user'])
  )

  await app.evaluate(() => customerIoHostFixture.revokeConsent())
  await app.evaluate(() => customerIoHostFixture.waitForClear('comfyui'))
  await app.evaluate(() => customerIoHostFixture.clickWorkflow())
  const revoked = await app.evaluate(() => customerIoHostFixture.snapshot())
  expect(revoked.publications.at(-1)).toMatchObject({
    surface: 'comfyui',
    session: null,
    granted: []
  })
})

test('late launcher identity cannot cross a native-view transition or consent revocation @macos @windows @linux', async ({
  host: app
}) => {
  await app.evaluate(() => customerIoHostFixture.waitForIdentity(0))
  await app.evaluate(() => customerIoHostFixture.switchTo('comfyui'))
  await app.evaluate(() => customerIoHostFixture.waitForMessage('comfyui'))
  await app.evaluate(() => customerIoHostFixture.switchTo('launcher'))
  await app.evaluate(() => customerIoHostFixture.waitForIdentity(1))
  await app.evaluate(() => customerIoHostFixture.waitForClear('comfyui'))
  const pending = await app.evaluate(() => customerIoHostFixture.snapshot().publications)

  // Awaiting the deferred promise drains the coordinator's identity callback:
  // negative assertions do not depend on an arbitrary quiet period.
  await app.evaluate(() => customerIoHostFixture.resolveIdentity(0, 'stale-firebase-user'))
  expect(await app.evaluate(() => customerIoHostFixture.snapshot().publications)).toEqual(pending)
  expect(await app.evaluate(() => customerIoHostFixture.messageCount('launcher'))).toBe(0)

  await app.evaluate(() => customerIoHostFixture.authChanged())
  await app.evaluate(() => customerIoHostFixture.waitForIdentity(2))
  await app.evaluate(() => customerIoHostFixture.resolveIdentity(1, 'signed-out-firebase-user'))
  expect(await app.evaluate(() => customerIoHostFixture.snapshot().publications)).toEqual(pending)
  await app.evaluate(() => customerIoHostFixture.revokeConsent())
  await app.evaluate(() => customerIoHostFixture.resolveIdentity(2, 'revoked-firebase-user'))
  expect(await app.evaluate(() => customerIoHostFixture.snapshot().publications)).toEqual(pending)
  expect(await app.evaluate(() => customerIoHostFixture.messageCount('launcher'))).toBe(0)
})

async function withHost(run: (app: ElectronApplication) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-customerio-host-'))
  let app: ElectronApplication | undefined
  try {
    const main = join(directory, 'main/main.cjs')
    const dependencies = resolve('e2e/support/customerIoHostDependencies.ts')
    const replaced = new Set(
      [
        'src/main/settings',
        'src/main/devplatform/session',
        'src/main/lib/firebaseAuthIdentity',
        'src/main/lib/i18n',
        'src/main/lib/ipc/shared'
      ].map((file) => resolve(file))
    )
    await build({
      entryPoints: [resolve('e2e/support/customerIoHostMain.ts')],
      outfile: main,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      plugins: [
        {
          name: 'hermetic-customerio-dependencies',
          setup(plugin) {
            plugin.onResolve({ filter: /^\./ }, (args) => {
              if (replaced.has(resolve(dirname(args.importer), args.path)))
                return { path: dependencies }
            })
          }
        }
      ]
    })
    const csp = (await readFile(resolve('src/renderer/panel.html'), 'utf8')).match(
      /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/
    )?.[0]
    expect(csp).toBeTruthy()
    await mkdir(join(directory, 'renderer'))
    await writeFile(
      join(directory, 'renderer/panel.html'),
      `<html><head>${csp}</head><body><h1>Desktop launcher fixture</h1></body></html>`
    )
    const env: Record<string, string> = {
      ...process.env,
      COMFY_CUSTOMER_IO_ENABLED: 'true',
      COMFY_CUSTOMER_IO_WRITE_KEY: 'fixture-write-key',
      COMFY_CUSTOMER_IO_SITE_ID: 'fixture-site',
      CUSTOMER_IO_FIXTURE_PROFILE: join(directory, 'profile'),
      CUSTOMER_IO_FIXTURE_PRELOADS: resolve('out/preload')
    }
    delete env.ELECTRON_RENDERER_URL
    // Match the existing Electron harness: Linux CI has no SUID sandbox binary.
    app = await _electron.launch({
      args: process.platform === 'linux' ? [main, '--no-sandbox'] : [main],
      env
    })
    await app.firstWindow()
    await app.evaluate(() => customerIoHostFixture.start())
    expect(await app.evaluate(() => customerIoHostFixture.snapshot().profile)).toBe(
      join(directory, 'profile')
    )
    await run(app)
    const result = await app.evaluate(() => customerIoHostFixture.snapshot())
    expect(result.errors).toEqual([])
    expect(
      result.queueUsers.every((user) =>
        ['launcher-firebase-user', 'local-firebase-user'].includes(user)
      )
    ).toBe(true)
    expect(result.siteIds.every((site) => site === 'fixture-site')).toBe(true)
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
}
