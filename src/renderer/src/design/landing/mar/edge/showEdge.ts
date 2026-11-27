import { nextTick } from 'vue'
import { go, hostActions, instanceById, proto } from '../../useProto'
import { setUser } from '../userStates/userState'
import { connection } from '../offline/connection'
import {
  diskRoom,
  downloadScenario,
  failNow,
  remove,
  startDownload,
  templateDownloads
} from '../downloads/templateDownloads'
import { modelsState } from '../build/models'
import { buildStart } from '../build/comfyStart'
import { forgetStartFailures, markRunning, stopBuild } from '../build/homeRun'
import { creditsState } from '../credits'
import { showHome, showScreen } from '../setup/setupFlow'
import { failSignIn, signInWithoutAccount } from '../signIn/browserSignIn'
import { manualModels } from '../graph/missingModels'
import { tplPick } from '../templateModal/tplPick'
import { tplById } from '../templateModal/templateData'
import { edgeCase, type EdgeCase } from './edgeStore'

const MODELS_MISSING = 'image_moss_image_t2i'
const LOCAL_ONLY = 'utility_seedvr2_image_upscale'
const OUT_OF_CREDITS = 'api_seedance2_5_i2v_1080p'
const BUILD = 'local-1'
const MISSING_WORKFLOW = 'krea-street'

function clearState(): void {
  connection.id = 'online'
  downloadScenario.id = 'normal'
  buildStart.id = 'starts'
  creditsState.id = 'active'
  proto.signedIn = true
  for (const id of diskRoom.removed.splice(0)) {
    const m = modelsState.models.find((x) => x.id === id)
    if (m) m.installed = true
  }
  diskRoom.freedGb = 0
  diskRoom.otherDrive = false
  manualModels.on = false
  manualModels.imported.clear()
  signInWithoutAccount()
  forgetStartFailures()
  for (const d of [...templateDownloads.list]) remove(d.id)
  tplPick.build = ''
}

function clearAll(): void {
  clearState()
  proto.detail = null
  proto.tabs.splice(0)
  showHome()
}

async function openFailedDownload(
  templateId: string,
  how: 'fail' | 'disk' | 'none'
): Promise<void> {
  go('explore')
  await nextTick()
  tplPick.build = BUILD
  proto.detail = { kind: 'template', id: templateId }
  await nextTick()
  const t = tplById(templateId)
  const inst = instanceById(BUILD)
  if (!t || !inst || how === 'none') return
  startDownload(t, inst)
  if (how === 'fail') failNow(templateId)
}

const SHOW: Record<Exclude<EdgeCase, 'off'>, () => void | Promise<void>> = {
  e1: () => {
    setUser('first')
    connection.id = 'offline'
    showScreen('first')
  },
  'e2-out': () => {
    proto.signedIn = false
    return openFailedDownload(MODELS_MISSING, 'fail')
  },
  'e2-credits': () => {
    creditsState.id = 'out'
    return openFailedDownload(MODELS_MISSING, 'fail')
  },
  'e2-pick': () => openFailedDownload(LOCAL_ONLY, 'fail'),
  e3: () => {
    downloadScenario.id = 'disk'
    return openFailedDownload(MODELS_MISSING, 'disk')
  },
  e5: () => {
    buildStart.id = 'failsTwice'
    const inst = instanceById(BUILD)
    if (!inst) return
    stopBuild(inst)
    hostActions.launch(inst)
  },
  e6: () => {
    manualModels.on = true
    const inst = instanceById(BUILD)
    if (!inst) return
    markRunning(inst)
    hostActions.launch(inst, MISSING_WORKFLOW)
  },
  e9: () => {
    setUser('first')
    showScreen('error')
  },
  e10: () => {
    setUser('first')
    showScreen('intel')
  },
  e11: () => openFailedDownload(OUT_OF_CREDITS, 'none'),
  e12: () => {
    proto.signedIn = false
    failSignIn('rejected')
  }
}

const FIRST_TIME: EdgeCase[] = ['e1', 'e9', 'e10']

export function leaveEdge(): void {
  const was = edgeCase.id
  edgeCase.id = 'off'
  clearState()
  if (was === 'off') return
  proto.detail = null
  proto.tabs.splice(0)
  showHome()
  go('explore')
}

export async function showEdge(id: EdgeCase): Promise<void> {
  edgeCase.id = id
  clearAll()
  if (id === 'off') return
  if (!FIRST_TIME.includes(id)) setUser('returning')
  await nextTick()
  await SHOW[id]()
}
