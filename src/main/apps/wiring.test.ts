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
const handled = all(main, /handleFromApps(?:Page)?\('([\w:-]+)'/g)

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

  it('a Cloud run takes only the model from the page and the app from its address', () => {
    expect(preload).toMatch(/const BRIDGE = 3\n/)
    expect(preload).toContain('run: (workflow: unknown, options?: { model?: string }) =>')
    expect(preload).toContain("ipcRenderer.invoke('comfy-apps:run', workflow, options)")
    expect(main).toContain("handleFromAppsPage('comfy-apps:run', run)")
    expect(main).toContain(
      'cloudAppTag(openAppId(pageUrl, APPS_URL), await desktopAppIds(), options)'
    )
    expect(main).toContain('body: cloudPromptBody(workflow, token, tag)')
  })

  it('refuses to show the apps page while the remote switch is off', () => {
    expect(main).toMatch(
      /function showApps\([^)]*\): void \{\n {2}if \(!isAppsEnabled\(\)\) return\n/
    )
  })

  it('local events go out on the channel the preload listens to', () => {
    const sent = local.match(/LOCAL_EVENT_CHANNEL = '([\w:-]+)'/)![1]
    expect(preload).toContain(`ipcRenderer.on('${sent}'`)
    expect(preload).toContain(`ipcRenderer.removeListener('${sent}'`)
  })
})
