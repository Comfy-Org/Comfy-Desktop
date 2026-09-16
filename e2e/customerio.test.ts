import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { CUSTOMER_IO_STATE } from '../src/shared/customerIo'
import type { CustomerIoSession } from '../src/shared/customerIo'

const identity: CustomerIoSession = {
  userId: 'desktop-test-user',
  locale: 'ja',
  writeKey: 'test-write-key',
  siteId: 'test-site'
}

/** Exercise the shipped preload and real SDK without a ComfyUI install or vendor traffic. */
test('Desktop SDK renders, dismisses, and revokes messages @macos @windows @linux', async () => {
  const testInfo = test.info()
  const directory = await mkdtemp(join(tmpdir(), 'comfy-customerio-'))
  let app: ElectronApplication | undefined
  try {
    const main = join(directory, 'main.cjs')
    await writeFile(
      main,
      `const { app, BrowserWindow, ipcMain } = require('electron')
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))})
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1100, height: 700, webPreferences: {
    preload: ${JSON.stringify(resolve('out/preload/comfyPreload.js'))},
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
    let delivery = 0
    await app.context().route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      requests.push({ url, body: request.postData(), headers: request.headers() })
      if (url.startsWith('http://127.0.0.1:8188')) {
        return route.fulfill({
          contentType: 'text/html',
          body: `<html><body style="background:#171717;color:white"><h1>ComfyUI fixture</h1>
<button id="workflow" onclick="this.textContent='Workflow running'">Run workflow</button>
<script>localStorage.setItem('fixture-auth', 'untouched')</script></body></html>`
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
        delivery += 1
        return route.fulfill({
          headers: {
            'x-gist-queue-polling-interval': '1',
            'access-control-expose-headers': 'x-gist-queue-polling-interval'
          },
          json: {
            inAppMessages: [
              {
                messageId: `fixture-message-${delivery}`,
                queueId: `fixture-queue-${delivery}`,
                priority: 1,
                properties: {
                  gist: {
                    campaignId: `fixture-delivery-${delivery}`,
                    routeRuleWeb: 'desktop/local-workflow'
                  }
                }
              }
            ],
            inboxMessages: []
          }
        })
      }
      // No request is allowed to reach Customer.io, including delivery metrics.
      return route.fulfill({ json: {} })
    })

    await page.goto('http://127.0.0.1:8188/private-workflow-name')
    await page.waitForFunction('typeof window.__comfyDesktop2 === "object"')
    expect(requests).toHaveLength(1)
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
    await message.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.locator('#gist-overlay')).toHaveCount(0)

    // Re-identification obtains another message, then auth/consent revocation
    // removes it while the workflow and its existing login storage remain usable.
    await update(null)
    await page.evaluate('globalThis.__comfyCustomerIo.update(null)')
    await update({ ...identity, userId: 'second-test-user' })
    await expect(message.getByRole('heading', { name: 'Desktop message fixture' })).toBeVisible()
    await update(null)
    await expect(page.locator('#gist-overlay')).toHaveCount(0)
    await page.getByRole('button', { name: 'Run workflow' }).click()
    await expect(page.getByRole('button', { name: 'Workflow running' })).toBeVisible()
    expect(await page.evaluate('localStorage.getItem("fixture-auth")')).toBe('untouched')
    expect(await page.evaluate('localStorage.length')).toBe(1)
    expect(await page.evaluate('typeof require')).toBe('undefined')
    const events = requests.filter(({ url }) =>
      /^https:\/\/cdp\.customer\.io\/v1\/[ipt]$/.test(url)
    )
    expect(events.some(({ body }) => body?.includes('"name":"desktop/local-workflow"'))).toBe(true)
    expect(events.every(({ body }) => !body?.includes('private-workflow-name'))).toBe(true)
    const queues = requests.filter(({ url }) => url.includes('/api/v4/users'))
    expect(queues.length).toBeGreaterThanOrEqual(2)
    expect(queues.every(({ headers }) => headers['x-cio-site-id'] === identity.siteId)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await app?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
