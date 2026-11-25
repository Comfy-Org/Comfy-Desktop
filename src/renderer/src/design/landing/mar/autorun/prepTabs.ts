import { reactive, watch } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { closeTab, proto } from '../../useProto'
import { downloadFor, templateDownloads } from '../downloads/templateDownloads'

export interface PrepTab {
  tabId: string
  templateId: string
  instId: string
  ready: boolean
}

export const prepTabs = reactive<{ list: PrepTab[] }>({ list: [] })

export const prepOfTab = (tabId: string): PrepTab | undefined =>
  prepTabs.list.find((p) => p.tabId === tabId)

export const prepOfTemplate = (templateId: string): PrepTab | undefined =>
  prepTabs.list.find((p) => p.templateId === templateId)

export function openPrepTab(t: Template, inst: ProtoInstance): void {
  if (prepOfTemplate(t.id)) return
  const tabId = `tab-${Date.now()}`
  proto.tabs.push({ id: tabId, title: inst.name, instanceId: inst.id, workflow: t.title })
  prepTabs.list.push({ tabId, templateId: t.id, instId: inst.id, ready: false })
}

export function dropPrepTab(tabId: string): void {
  prepTabs.list = prepTabs.list.filter((p) => p.tabId !== tabId)
}

watch(
  () => templateDownloads.list.map((d) => `${d.id}:${d.status}`).join(),
  () => {
    for (const p of [...prepTabs.list]) {
      if (p.ready) continue
      const d = downloadFor(p.templateId)
      if (d && d.status !== 'cancelled') continue
      dropPrepTab(p.tabId)
      closeTab(p.tabId)
    }
  }
)

watch(
  () => proto.tabs.map((t) => t.id).join(),
  () => {
    const open = new Set(proto.tabs.map((t) => t.id))
    prepTabs.list = prepTabs.list.filter((p) => open.has(p.tabId))
  }
)
