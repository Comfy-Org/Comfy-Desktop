import { computed, reactive, watch } from 'vue'
import { activeInstance, hostActions, instanceById, proto } from '../../useProto'
import type { ProtoInstance, Template } from '../../mock'
import type { ProjectWorkflow } from '../../gallery'
import { graphOpen, type AgentStart } from '../graph/graphOpen'
import type { NodeKind, Recipe } from '../graph/canvasData'
import { marTabsOn } from '../shell/titleTabs'

export const NEW_TAB_ID = 'new-tab'
export const NEW_TAB_TITLE = 'New tab'

export const createScreen = reactive({
  open: false,
  after: null as string | null,
  back: 'home'
})

export const createInTab = computed(() => marTabsOn.value)

export const createTabFront = computed(
  () => createInTab.value && createScreen.open && proto.activeTab === NEW_TAB_ID
)

export const createOverHome = computed(() => !createInTab.value && createScreen.open)

export function newTabIndex(): number {
  if (!createScreen.after) return 0
  const i = proto.tabs.findIndex((t) => t.id === createScreen.after)
  return i < 0 ? proto.tabs.length : i + 1
}

export function openCreate(): void {
  if (!createInTab.value) {
    proto.activeTab = 'home'
    createScreen.open = true
    return
  }
  if (!createScreen.open) {
    createScreen.open = true
    createScreen.after = proto.tabs.at(-1)?.id ?? null
  }
  if (proto.activeTab !== NEW_TAB_ID) createScreen.back = proto.activeTab
  proto.activeTab = NEW_TAB_ID
}

function backTab(): string {
  return proto.tabs.some((t) => t.id === createScreen.back) ? createScreen.back : 'home'
}

export function closeCreate(): void {
  if (!createScreen.open) return
  createScreen.open = false
  if (proto.activeTab === NEW_TAB_ID) proto.activeTab = backTab()
}

watch(
  () => proto.milestone,
  () => (createScreen.open = false)
)
watch(
  () => proto.page,
  () => createOverHome.value && closeCreate()
)
watch(
  () => proto.activeTab,
  (tab) => createOverHome.value && tab !== 'home' && closeCreate()
)
watch(
  () => [proto.activeTab, createScreen.open, createInTab.value] as const,
  ([tab, open, inTab]) => {
    if (tab === NEW_TAB_ID && (!open || !inTab)) proto.activeTab = 'home'
  }
)

function fillNewTab(inst: ProtoInstance, workflow: string): void {
  const at = newTabIndex()
  createScreen.open = false
  const id = `tab-${Date.now()}`
  proto.tabs.splice(at, 0, { id, title: inst.name, instanceId: inst.id, workflow })
  proto.detail = null
  proto.activeInstanceId = inst.id
  proto.activeTab = id
}

function openInNewTab(inst: ProtoInstance): void {
  const open = proto.tabs.some((t) => t.instanceId === inst.id)
  if (!open || (inst.kind === 'cloud' && !proto.signedIn)) {
    hostActions.launch(inst, 'Untitled workflow')
    return
  }
  const id = `tab-${Date.now()}`
  proto.tabs.push({ id, title: inst.name, instanceId: inst.id, workflow: 'Untitled workflow' })
  proto.activeInstanceId = inst.id
  proto.activeTab = id
}

function land(inst: ProtoInstance, workflow: string, reuse: boolean): void {
  const tabbed = createInTab.value && createScreen.open
  if (!tabbed || (inst.kind === 'cloud' && !proto.signedIn)) {
    closeCreate()
    if (reuse) hostActions.launch(inst, workflow)
    else openInNewTab(inst)
    return
  }
  const same = reuse && proto.tabs.find((t) => t.instanceId === inst.id && t.workflow === workflow)
  if (same) {
    createScreen.open = false
    proto.activeInstanceId = inst.id
    proto.activeTab = same.id
    return
  }
  fillNewTab(inst, workflow)
}

export function startBlank(): void {
  graphOpen.scratch = true
  land(activeInstance.value, 'Untitled workflow', false)
}

export function startWithNode(kind: NodeKind, model?: string): void {
  graphOpen.start = { kind, model }
  land(activeInstance.value, 'Untitled workflow', false)
}

export function startWithRecipe(recipe: Recipe): void {
  graphOpen.recipe = recipe
  land(activeInstance.value, 'Untitled workflow', false)
}

export function startWithAgent(): void {
  graphOpen.agent = true
  land(activeInstance.value, 'Untitled workflow', false)
}

export function startWithAgentAsk(start: AgentStart): void {
  graphOpen.agentAsk = start
  land(activeInstance.value, 'Untitled workflow', false)
}

export function startWithNodeSearch(): void {
  graphOpen.nodeSearch = true
  land(activeInstance.value, 'Untitled workflow', false)
}

export function openWorkflow(w: ProjectWorkflow): void {
  const inst = (w.envId && instanceById(w.envId)) || activeInstance.value
  land(inst, w.name, true)
}

export function openTemplate(t: Template): void {
  land(activeInstance.value, t.title, true)
}
