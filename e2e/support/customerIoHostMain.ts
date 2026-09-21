import { app, BrowserWindow, WebContentsView, protocol } from 'electron'
import { join } from 'node:path'
import { once } from 'node:events'
import { attachCustomerIoMessaging } from '../../src/main/lib/customerIoMessaging'
import { customerIoEvents } from '../../src/main/lib/customerIoEvents'
import type { ComfyWindowEntry } from '../../src/main/host/registry'
import { CUSTOMER_IO_READY, CUSTOMER_IO_STATE } from '../../src/shared/customerIo'
import type { CustomerIoSession } from '../../src/shared/customerIo'
import {
  authChanged,
  resolveIdentity,
  setConsent,
  waitForIdentity
} from './customerIoHostDependencies'

type Surface = 'launcher' | 'comfyui'
interface Publication {
  surface: Surface
  session: CustomerIoSession | null
  visible: Surface[]
  granted: Surface[]
}

function createFixture() {
  const queueUsers: string[] = []
  const siteIds: string[] = []
  const errors: string[] = []
  const respond = (request: Request): Response => {
    const url = request.url
    const html = (body: string): Response =>
      new Response(body, {
        headers: { 'content-type': 'text/html' }
      })
    const json = (body: unknown): Response =>
      Response.json(body, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*'
        }
      })
    if (request.method === 'OPTIONS') return json({})
    if (url.startsWith('http://127.0.0.1:8188/'))
      return html(`<html><body><button id="workflow">Run workflow</button><script>
document.getElementById('workflow').onclick = event => { event.target.textContent = 'Workflow running' };
</script></body></html>`)
    if (url.endsWith('/settings'))
      return json({
        integrations: { 'Customer.io Data Pipelines': { apiKey: 'fixture-write-key' } },
        plan: { track: {} }
      })
    if (url.includes('/api/v4/users')) {
      const user = Buffer.from(
        request.headers.get('x-gist-encoded-user-token') ?? '',
        'base64'
      ).toString()
      queueUsers.push(user)
      siteIds.push(request.headers.get('x-cio-site-id') ?? '')
      return json({
        inAppMessages: [
          {
            messageId: user,
            queueId: `queue-${user}`,
            priority: 1,
            properties: {
              gist: {
                campaignId: user,
                routeRuleWeb:
                  user === 'launcher-firebase-user' ? 'desktop/launcher' : 'desktop/comfyui'
              }
            }
          }
        ],
        inboxMessages: []
      })
    }
    if (url.startsWith('https://renderer.gist.build/'))
      return html('<script>location.replace("https://code.gist.build/fixture")</script>')
    if (url.startsWith('https://code.gist.build/'))
      return html(`<html><body><h2>Desktop message fixture</h2><script>
window.addEventListener('message', event => {
  if (!event.data.options) return;
  parent.postMessage({gist:{instanceId:event.data.options.instanceId,method:'routeLoaded',parameters:{route:'start',width:400,height:200}}}, '*');
});
</script></body></html>`)
    return json({})
  }
  // Protocol interception covers native child views before their first request,
  // including the SDK iframe and metrics. Nothing falls through to the network.
  protocol.handle('http', respond)
  protocol.handle('https', respond)
  const window = new BrowserWindow({ width: 1100, height: 700, show: false })
  void window.loadURL('about:blank')
  const view = (preload: string): WebContentsView =>
    new WebContentsView({
      webPreferences: {
        preload: join(process.env.CUSTOMER_IO_FIXTURE_PRELOADS!, preload),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
  const views = { launcher: view('index.js'), comfyui: view('comfyPreload.js') }
  const publications: Publication[] = []
  const readyFrames: { surface: Surface; mainFrame: boolean; url: string }[] = []
  const grants = new Set<Surface>()
  const visible = (): Surface[] =>
    (Object.keys(views) as Surface[]).filter((surface) => views[surface].getVisible())
  for (const surface of Object.keys(views) as Surface[]) {
    const nativeView = views[surface]
    window.contentView.addChildView(nativeView)
    nativeView.setBounds({ x: 0, y: 0, width: 1100, height: 700 })
    nativeView.setVisible(surface === 'launcher')
    nativeView.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message))
    nativeView.webContents.on('ipc-message', (event, channel) => {
      if (channel === CUSTOMER_IO_READY)
        readyFrames.push({
          surface,
          mainFrame: event.senderFrame === nativeView.webContents.mainFrame,
          url: nativeView.webContents.getURL()
        })
    })
  }
  // Observe real IPC across main-frame replacement on the initial navigation.
  // The original Electron method still delivers every publication to the preload.
  const prototype = Object.getPrototypeOf(
    views.launcher.webContents.mainFrame
  ) as Electron.WebFrameMain
  const send = prototype.send
  prototype.send = function (channel: string, ...args: unknown[]): void {
    if (channel === CUSTOMER_IO_STATE) {
      const surface = (Object.keys(views) as Surface[]).find(
        (name) => views[name].webContents.mainFrame === this
      )
      if (surface) {
        const session = args[0] as CustomerIoSession | null
        if (session) grants.add(surface)
        else grants.delete(surface)
        publications.push({ surface, session, visible: visible(), granted: [...grants] })
      }
    }
    send.call(this, channel, ...args)
  }
  const entry = {
    window,
    comfyView: views.comfyui,
    panelView: views.launcher,
    installationId: null,
    sourceCategory: null,
    activePanel: 'comfy',
    firstUseMode: 'none',
    comfyUrl: 'http://127.0.0.1:8188/'
  } as ComfyWindowEntry
  const dispose = attachCustomerIoMessaging(entry)
  window.on('closed', () => {
    dispose()
    for (const nativeView of Object.values(views)) nativeView.webContents.close()
  })
  const waitForDom = (surface: Surface, expression: string): Promise<void> =>
    views[surface].webContents.executeJavaScript(`new Promise(resolve => {
      const ready = () => {
        if (!(${expression})) return;
        observer.disconnect();
        document.removeEventListener('transitionend', ready, true);
        resolve();
      };
      const observer = new MutationObserver(ready);
      observer.observe(document.documentElement, {childList:true, subtree:true, attributes:true});
      document.addEventListener('transitionend', ready, true);
      ready();
    })`)
  return {
    async start() {
      await Promise.all([
        views.launcher.webContents.loadFile(join(__dirname, '../renderer/panel.html')),
        views.comfyui.webContents.loadURL(entry.comfyUrl)
      ])
      // Establish focus after initial native-view navigation has finished.
      const focused = once(window, 'focus')
      window.show()
      app.focus({ steal: true })
      window.focus()
      await focused
    },
    switchTo(surface: Surface) {
      // Exercise the host's visibility-before-refresh contract with real native
      // views. No installation process or Desktop profile is needed.
      entry.installationId = 'fixture-install'
      entry.sourceCategory = 'local'
      entry.activePanel = surface === 'comfyui' ? 'comfy' : 'quick-install'
      views[surface === 'comfyui' ? 'launcher' : 'comfyui'].setVisible(false)
      views[surface].setVisible(true)
      entry.refreshCustomerIo!()
    },
    revokeConsent() {
      setConsent(false)
      customerIoEvents.emit('changed')
    },
    authChanged,
    resolveIdentity,
    waitForIdentity,
    messageCount: (surface: Surface): Promise<number> =>
      views[surface].webContents.executeJavaScript(
        'document.querySelectorAll("iframe.gist-message").length'
      ),
    async waitForMessage(surface: Surface) {
      await waitForDom(
        surface,
        `document.querySelector('iframe.gist-message') && getComputedStyle(document.querySelector('iframe.gist-message')).opacity === '1'`
      )
      const frame = views[surface].webContents.mainFrame.framesInSubtree.find((frame) =>
        frame.url.startsWith('https://code.gist.build/')
      )
      if (
        !frame ||
        (await frame.executeJavaScript('document.querySelector("h2").textContent')) !==
          'Desktop message fixture'
      )
        throw new Error('SDK message iframe did not render')
      const count = await views[surface].webContents.executeJavaScript(
        'document.querySelectorAll("iframe.gist-message").length'
      )
      if (count !== 1) throw new Error(`Expected one message iframe, received ${count}`)
    },
    waitForClear: (surface: Surface) =>
      waitForDom(surface, `!document.querySelector('#gist-overlay')`),
    async clickWorkflow() {
      const contents = views.comfyui.webContents
      const point = await contents.executeJavaScript(`(() => {
        const button = document.getElementById('workflow');
        const bounds = button.getBoundingClientRect();
        const x = Math.floor(bounds.x + bounds.width / 2), y = Math.floor(bounds.y + bounds.height / 2);
        if (document.elementFromPoint(x, y) !== button) throw new Error('Revoked message still intercepts input');
        return { x, y };
      })()`)
      contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      await waitForDom(
        'comfyui',
        `document.getElementById('workflow').textContent === 'Workflow running'`
      )
    },
    snapshot: () => ({
      publications: [...publications],
      visible: visible(),
      focused: window.isFocused(),
      readyFrames: [...readyFrames],
      urls: Object.fromEntries(
        Object.entries(views).map(([surface, view]) => [surface, view.webContents.getURL()])
      ),
      panelPath: join(__dirname, '../renderer/panel.html'),
      profile: app.getPath('userData'),
      queueUsers: [...queueUsers],
      siteIds: [...siteIds],
      errors: [...errors]
    })
  }
}

declare global {
  var customerIoHostFixture: ReturnType<typeof createFixture>
}

// Set the disposable profile before readiness, including Chromium session data.
app.setPath('userData', process.env.CUSTOMER_IO_FIXTURE_PROFILE!)
app.setPath('sessionData', process.env.CUSTOMER_IO_FIXTURE_PROFILE!)
void app.whenReady().then(() => {
  globalThis.customerIoHostFixture = createFixture()
})
