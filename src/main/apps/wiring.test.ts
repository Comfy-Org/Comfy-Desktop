// @vitest-environment node
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const preload = readFileSync(resolve(__dirname, '../../preload/appsPreload.ts'), 'utf8')
const main = readFileSync(resolve(__dirname, 'appsView.ts'), 'utf8')
const local = readFileSync(resolve(__dirname, 'localComfy.ts'), 'utf8')

const all = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!)

const calls = all(preload.match(/const CALLS = \[([\s\S]*?)\]/)![1]!, /'(\w+)'/g)
const exposed = all(
  preload.match(/exposeInMainWorld\('comfyDesktopApps', \{([\s\S]*)\}\)/)![1]!,
  /^ {2}(\w+):/gm
)
const invoked = all(preload, /ipcRenderer\.invoke\('([\w:-]+)'/g)
const handled = all(main, /handleFromApp(?:s|Page)\('([\w:-]+)'/g)

describe('Apps bridge wiring', () => {
  it('getInfo names exactly the calls the page gets', () => {
    expect([...calls].sort()).toEqual([...exposed].sort())
  })

  it('has the local ComfyUI calls', () => {
    for (const c of [
      'getLocal',
      'startLocal',
      'cancelSetup',
      'localBuilds',
      'localFetch',
      'onLocalEvent',
      'localDownload',
      'cancelRun',
      'openInComfy'
    ]) {
      expect(calls).toContain(c)
    }
  })

  it('every channel the page invokes is answered behind the apps-page check', () => {
    for (const channel of invoked) expect(handled).toContain(channel)
    expect(main).not.toMatch(/ipcMain\.handle\('comfy-apps:/)
  })

  it('passes the app tag with a Cloud run only when the page gives one', () => {
    expect(preload).toMatch(/const BRIDGE = 3\n/)
    expect(preload).toContain("ipcRenderer.invoke('comfy-apps:run', workflow, app)")
    expect(main).toMatch(/async function run\(page: AppPage, workflow: unknown, app\?: unknown\)/)
    expect(main).toContain('body: cloudPromptBody(workflow, token, tag)')
  })

  it('reports Cloud runs that fail before a job exists, and saved results', () => {
    expect(main).toContain("cloudRunFailed(appId, { step: 'sign_in' })")
    expect(main).toContain('cloudRunFailed(appId, cloudRefusal(res.status, answer))')
    expect(main).toContain('cloudRunFailed(appId, cloudRefusal(res.status, body))')
    expect(main).toContain("step: 'upload'")
    expect(main).toContain("trackApps('output_saved', { app: page.app, where })")
    for (const channel of ['run', 'upload-image', 'save-file', 'local-fetch']) {
      expect(main).toContain(`handleFromAppPage('comfy-apps:${channel}'`)
    }
  })

  it('refuses to show the apps page while the remote switch is off', () => {
    expect(main).toMatch(/function showApps\([^)]*\): void \{\n {2}if \(!isAppsEnabled\(\)\) return\n/)
  })

  it('local events go out on the channel the preload listens to', () => {
    const sent = local.match(/LOCAL_EVENT_CHANNEL = '([\w:-]+)'/)![1]
    expect(preload).toContain(`ipcRenderer.on('${sent}'`)
    expect(preload).toContain(`ipcRenderer.removeListener('${sent}'`)
  })
})
