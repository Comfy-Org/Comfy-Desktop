import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { CUSTOMER_IO_PAGES, CUSTOMER_IO_STATE } from '../src/shared/customerIo'
import type { CustomerIoSession } from '../src/shared/customerIo'

const defaultIdentity: CustomerIoSession = {
  userId: 'desktop-test-user',
  locale: 'ja',
  writeKey: 'test-write-key',
  siteId: 'test-site',
  page: 'desktop/comfyui'
}

/** Exercise the shipped preload and real SDK without a ComfyUI install or vendor traffic. */
async function exerciseMessaging(surface: keyof typeof CUSTOMER_IO_PAGES): Promise<void> {
  const identity = { ...defaultIdentity, page: CUSTOMER_IO_PAGES[surface] }
  const testInfo = test.info()
  const directory = await mkdtemp(join(tmpdir(), 'comfy-customerio-'))
  let app: ElectronApplication | undefined
  let holdViewLog = false
  let viewLogPending = false
  let releaseViewLog!: () => void
  const viewLog = new Promise<void>((resolve) => {
    releaseViewLog = resolve
  })
  try {
    const csp =
      surface === 'launcher'
        ? (await readFile(resolve('src/renderer/panel.html'), 'utf8')).match(
            /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/
          )?.[0]
        : ''
    if (surface === 'launcher') expect(csp).toBeTruthy()
    const fixtureHtml = `<html><head>${csp ?? ''}</head><body style="background:#171717;color:white"><h1>Desktop ${surface} fixture</h1>
<button id="workflow">Run workflow</button></body></html>`
    const fixtureFile = join(directory, 'private-workflow-name.html')
    await writeFile(fixtureFile, fixtureHtml)
    const main = join(directory, 'main.cjs')
    await writeFile(
      main,
      `const { app, BrowserWindow, ipcMain } = require('electron')
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1100, height: 700, webPreferences: {
    preload: ${JSON.stringify(resolve(`out/preload/${surface === 'launcher' ? 'index' : 'comfyPreload'}.js`))},
    contextIsolation: true, sandbox: false, nodeIntegration: false
  } })
  window.loadURL('about:blank')
  ipcMain.on('customerio:action', event => { event.returnValue = false })
})`
    )
    // Match the existing Electron harness: Linux CI has no SUID sandbox binary.
    const args = process.platform === 'linux' ? [main, '--no-sandbox'] : [main]
    app = await _electron.launch({ args })
    const page = await app.firstWindow()
    const requests: { url: string; body: string | null; headers: Record<string, string> }[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const deliveries = new Map<string, number>()
    await app.context().route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      requests.push({ url, body: request.postData(), headers: request.headers() })
      if (
        url.startsWith('http://127.0.0.1:8188') ||
        url.startsWith(pathToFileURL(fixtureFile).href)
      ) {
        return route.fulfill({
          contentType: 'text/html',
          body: fixtureHtml
        })
      }
      if (url.endsWith('/settings')) {
        return route.fulfill({
          json: {
            integrations: {
              'Customer.io Data Pipelines': { apiKey: identity.writeKey },
              // The Desktop registration must override source-level auto setup.
              'Customer.io In-App Plugin': { enabled: true, siteId: 'wrong-source-site' }
            },
            plan: { track: {} }
          }
        })
      }
      if (url.startsWith('https://renderer.gist.build/')) {
        // A separate navigation keeps interception active for the fixture renderer.
        return route.fulfill({
          contentType: 'text/html',
          body: '<script>location.replace("https://code.gist.build/fixture")</script>'
        })
      }
      if (url.startsWith('https://code.gist.build/')) {
        return route.fulfill({
          contentType: 'text/html',
          body: `<html><body style="background:white;color:black"><h2>Desktop message fixture</h2>
<button id="close">Dismiss</button><script>
let instanceId;
window.addEventListener('message', event => {
  if (!event.data.options) return;
  instanceId = event.data.options.instanceId;
  parent.postMessage({gist:{instanceId,method:'routeLoaded',parameters:{route:'start',width:400,height:200}}}, '*');
});
document.getElementById('close').onclick = () => parent.postMessage({gist:{instanceId,method:'tap',parameters:{action:'gist://close',name:'Dismiss'}}}, '*');
</script></body></html>`
        })
      }
      if (url.includes('/api/v4/users')) {
        const user = request.headers()['x-gist-encoded-user-token'] ?? ''
        if (!deliveries.has(user)) deliveries.set(user, deliveries.size + 1)
        // Polls return the same delivery until dismissed, as the service does.
        // Inventing a new campaign every poll makes slow runs show another modal
        // immediately after the first one closes.
        const delivery = deliveries.get(user)!
        return route.fulfill({
          headers: {
            'x-gist-queue-polling-interval': '1',
            'access-control-expose-headers': 'x-gist-queue-polling-interval'
          },
          json: {
            inAppMessages: [
              {
                messageId: 'private-route-message',
                queueId: 'private-route-queue',
                priority: 0,
                properties: { gist: { routeRuleWeb: '^/private-workflow-name$' } }
              },
              {
                messageId: `fixture-message-${delivery}`,
                queueId: `fixture-queue-${delivery}`,
                priority: 1,
                properties: {
                  gist: {
                    campaignId: `fixture-delivery-${delivery}`,
                    routeRuleWeb: identity.page,
                    persistent:
                      request.headers()['x-gist-encoded-user-token'] ===
                      Buffer.from('second-test-user').toString('base64')
                  }
                }
              }
            ],
            inboxMessages: []
          }
        })
      }
      if (holdViewLog && url.includes('/api/v1/logs/')) {
        viewLogPending = true
        await viewLog
      }
      // No request is allowed to reach Customer.io, including delivery metrics.
      return route.fulfill({ json: {} })
    })

    const fixtureUrl =
      surface === 'launcher'
        ? pathToFileURL(fixtureFile).href
        : 'http://127.0.0.1:8188/private-workflow-name'
    await page.goto(
      `${fixtureUrl}?private-query=workflow-secret&ajs_uid=unverified-person&ajs_event=private-event&utm_campaign=private-campaign&btid=private-ad`,
      surface === 'comfyui' ? { referer: 'http://127.0.0.1:8188/private-referrer' } : undefined
    )
    await page.waitForFunction(
      surface === 'launcher'
        ? 'typeof window.api === "object"'
        : 'typeof window.__comfyDesktop2 === "object"'
    )
    await page.evaluate(`
      localStorage.setItem('fixture-auth', 'untouched');
      document.getElementById('workflow').addEventListener('click', event => {
        event.target.textContent = 'Workflow running';
      });
    `)
    expect(requests.filter(({ url }) => url.startsWith('https://'))).toHaveLength(0)
    const update = async (session: CustomerIoSession | null): Promise<void> => {
      await app!.evaluate(
        ({ BrowserWindow }, { channel, session }) => {
          BrowserWindow.getAllWindows()[0]!.webContents.send(channel, session)
        },
        { channel: CUSTOMER_IO_STATE, session }
      )
    }
    const message = page.frameLocator('iframe.gist-message')
    await update(identity)
    await expect(message.getByRole('heading', { name: 'Desktop message fixture' })).toBeVisible()
    await expect(page.locator('iframe.gist-message')).toHaveCSS('opacity', '1')
    await expect
      .poll(() => requests.some(({ body }) => body?.includes('"metric":"opened"')))
      .toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('customerio-message.png'),
      animations: 'disabled'
    })
    await expect
      .poll(() => requests.filter(({ url }) => url.includes('/api/v4/users')).length)
      .toBeGreaterThanOrEqual(2)
    await message.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.locator('#gist-overlay')).toHaveCount(0)

    // Re-identification obtains another message, then auth/consent revocation
    // removes it while the workflow and its existing login storage remain usable.
    await update(null)
    await page.evaluate('globalThis.__comfyCustomerIo.update(null)')
    await update({ ...identity, userId: 'second-test-user' })
    await expect(message.getByRole('heading', { name: 'Desktop message fixture' })).toBeVisible()
    holdViewLog = true
    await update(null)
    await expect.poll(() => viewLogPending).toBe(true)
    // Revocation must release input before the persistent-message view log
    // completes. Checking the hit target cannot pass by waiting for its timeout.
    expect(
      await page.getByRole('button', { name: 'Run workflow' }).evaluate((button) => {
        const bounds = button.getBoundingClientRect()
        return (
          button.ownerDocument.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          ) === button
        )
      })
    ).toBe(true)
    await page.getByRole('button', { name: 'Run workflow' }).click()
    releaseViewLog()
    await expect(page.locator('#gist-overlay')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Workflow running' })).toBeVisible()
    expect(await page.evaluate('localStorage.getItem("fixture-auth")')).toBe('untouched')
    expect(await page.evaluate('localStorage.length')).toBe(1)
    expect(await page.evaluate('typeof require')).toBe('undefined')
    const events = requests.filter(({ url }) =>
      /^https:\/\/cdp\.customer\.io\/v1\/[ipt]$/.test(url)
    )
    expect(events.some(({ body }) => body?.includes(`"name":"${identity.page}"`))).toBe(true)
    expect(
      events.every(
        ({ body }) =>
          !/private-workflow|private-query|private-referrer|private-event|private-campaign|private-ad|unverified-person/.test(
            body ?? ''
          )
      )
    ).toBe(true)
    const pages = events.filter(({ url }) => url.endsWith('/p'))
    expect(pages.length).toBeGreaterThan(0)
    for (const { body } of pages) {
      expect(JSON.parse(body!).properties).toMatchObject({ search: '', referrer: '' })
    }

    const queues = requests.filter(({ url }) => url.includes('/api/v4/users'))
    expect(queues.length).toBeGreaterThanOrEqual(2)
    expect(queues.every(({ headers }) => headers['x-cio-site-id'] === identity.siteId)).toBe(true)
    expect(requests.every(({ url }) => !url.includes('private-route-message'))).toBe(true)
    expect(
      queues.every(({ headers }) =>
        ['desktop-test-user', 'second-test-user'].includes(
          Buffer.from(headers['x-gist-encoded-user-token'] ?? '', 'base64').toString()
        )
      )
    ).toBe(true)
    expect(errors).toEqual([])
  } finally {
    releaseViewLog()
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

for (const surface of ['comfyui', 'launcher'] as const) {
  test(`Desktop ${surface} SDK renders, dismisses, and revokes messages @macos @windows @linux`, async () => {
    await exerciseMessaging(surface)
  })
}
