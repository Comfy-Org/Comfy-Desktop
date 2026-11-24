import { appsProto } from '../../appFlow'
import { proto } from '../../useProto'
import { runs, uninstalled, updated } from '../build/homeRun'
import { createScreen } from '../create/createScreen'
import { favorites } from '../favorites'
import { search } from '../search/search'
import { browserSignIn, forgetNewAccount } from '../signIn/browserSignIn'
import { homeTour } from '../homeTour/homeTour'
import { setUser } from '../userStates/userState'
import { flow, localSetup, showScreen } from './setupFlow'

function forgetSession(): void {
  proto.tabs = []
  proto.activeTab = 'home'
  proto.mode = 'create'
  proto.page = 'overview'
  proto.detail = null
  proto.deploying = null
  proto.deployingTool = null
  proto.launching = null
  proto.loginPrompt = null
  proto.draft = null
  proto.addedInstances = []
  proto.installedVersion = ''
  proto.signedIn = false
  proto.workspaceId = 'personal'
  appsProto.tabs = []
  appsProto.front = ''
  appsProto.added = []
  search.open = false
  createScreen.open = false
  favorites.keys = []
  runs.clear()
  uninstalled.clear()
  updated.clear()
  forgetNewAccount()
  Object.assign(browserSignIn, {
    pending: false,
    banner: false,
    browser: false,
    step: 'consent',
    added: 0
  })
}

function forgetInstall(): void {
  Object.assign(flow, {
    another: false,
    buildName: '',
    background: false,
    homeCard: false,
    ready: false
  })
}

export function replayOnboarding(): void {
  forgetSession()
  forgetInstall()
  setUser('first')
  homeTour.id = 'auto'
  homeTour.done.new = false
  homeTour.replays += 1
  localSetup.mode = 'on'
  localSetup.scope = 'next'
  if (localSetup.machine !== 'ready' && localSetup.machine !== 'legacy') {
    localSetup.machine = 'ready'
  }
  showScreen('first')
}
