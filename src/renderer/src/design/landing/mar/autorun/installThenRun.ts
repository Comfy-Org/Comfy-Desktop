import { INSTANCES, type Template } from '../../mock'
import { closeTab, instanceById, proto } from '../../useProto'
import { notify } from '../pages/undo'
import { marUser } from '../userStates/userState'
import { DETECTED } from '../setup/setupFlow'
import { startDownload } from '../downloads/templateDownloads'
import { needsFor } from '../templateModal/templateData'
import { runTemplate } from './autorun'
import { dropPrepTab, openPrepTab, prepOfTab, type PrepTab } from './prepTabs'

export const BUILD_INSTALLING = 'Installing ComfyUI'
export const OPEN_BUILD = 'Open build'

const INSTALL_PHASES = [
  { until: 30, label: 'Downloading ComfyUI…' },
  { until: 42, label: 'Unpacking the install…' },
  { until: 101, label: 'Setting up your Python environment…' }
]

export const installPhase = (percent: number): string =>
  (INSTALL_PHASES.find((p) => percent < p.until) ?? INSTALL_PHASES.at(-1)!).label

const INSTALL_MS = 9000
const TICK_MS = 150
const timers = new Map<string, ReturnType<typeof setInterval>>()

function stopInstall(tabId: string): void {
  clearInterval(timers.get(tabId))
  timers.delete(tabId)
}

export function cancelInstall(tabId: string): void {
  stopInstall(tabId)
  dropPrepTab(tabId)
  closeTab(tabId)
}

function installed(prep: PrepTab, t: Template): void {
  stopInstall(prep.tabId)
  marUser.local = 'one'
  proto.installedVersion = DETECTED.version
  prep.install = undefined
  const inst = instanceById(prep.instId)
  if (!inst) return
  const watching = proto.activeTab === prep.tabId
  const showTab = (): void => {
    proto.activeInstanceId = inst.id
    proto.activeTab = prep.tabId
  }
  if (needsFor(t).length) {
    startDownload(t, inst)
    if (!watching) notify(`${inst.name} is installed`, showTab, 'success', OPEN_BUILD)
    return
  }
  prep.ready = true
  if (watching) runTemplate(t, inst)
  else notify(`${inst.name} is installed`, () => runTemplate(t, inst), 'success', OPEN_BUILD)
}

export function installThenRun(t: Template): void {
  const inst = INSTANCES.find((i) => i.kind === 'local')
  if (!inst) return
  const prep = openPrepTab(t, inst)
  proto.detail = null
  proto.activeInstanceId = inst.id
  proto.activeTab = prep.tabId
  if (prep.install || timers.has(prep.tabId)) return
  prep.install = { percent: 0 }
  const t0 = Date.now()
  timers.set(
    prep.tabId,
    setInterval(() => {
      const live = prepOfTab(prep.tabId)
      if (!live?.install) {
        stopInstall(prep.tabId)
        return
      }
      live.install.percent = Math.min(100, ((Date.now() - t0) / INSTALL_MS) * 100)
      if (live.install.percent >= 100) installed(live, t)
    }, TICK_MS)
  )
}
