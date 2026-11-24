import { reactive, watch } from 'vue'
import { activeInstance, hostActions, instanceById, proto } from '../../useProto'
import type { ProtoInstance, Template } from '../../mock'
import type { ProjectWorkflow } from '../../gallery'
import { graphOpen } from '../graph/graphOpen'
import type { NodeKind } from '../graph/canvasData'

export const createScreen = reactive({ open: false })

export function openCreate(): void {
  proto.activeTab = 'home'
  createScreen.open = true
}

export function closeCreate(): void {
  createScreen.open = false
}

watch(
  () => [proto.page, proto.milestone],
  () => closeCreate()
)
watch(
  () => proto.activeTab,
  (tab) => tab !== 'home' && closeCreate()
)

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

export function startBlank(): void {
  closeCreate()
  graphOpen.scratch = true
  openInNewTab(activeInstance.value)
}

export function startWithNode(kind: NodeKind, model?: string): void {
  closeCreate()
  graphOpen.start = { kind, model }
  openInNewTab(activeInstance.value)
}

export function openWorkflow(w: ProjectWorkflow): void {
  closeCreate()
  const inst = (w.envId && instanceById(w.envId)) || activeInstance.value
  hostActions.launch(inst, w.name)
}

export function openTemplate(t: Template): void {
  closeCreate()
  hostActions.launch(activeInstance.value, t.title)
}
