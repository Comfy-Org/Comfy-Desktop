import { computed, nextTick } from 'vue'
import { openDetail, proto } from '../../useProto'
import { leaveEdge } from '../edge/showEdge'
import { edgeCase } from '../edge/edgeStore'
import { forgetDownloaded } from '../templateOpen/installed'
import { marUser, setUser } from '../userStates/userState'
import { CANT_RUN_CASES, tplById, type CantRunCase } from './templateData'

export const caseOpen = computed<CantRunCase | undefined>(() => {
  const d = proto.detail
  if (edgeCase.id !== 'off') return undefined
  return d?.kind === 'template' ? CANT_RUN_CASES.find((c) => c.template === d.id) : undefined
})

export const caseTemplateName = (c: CantRunCase): string => tplById(c.template)?.title ?? c.template

export async function openCase(c: CantRunCase): Promise<void> {
  leaveEdge()
  proto.detail = null
  if (marUser.user !== 'returning' || marUser.local !== 'several') setUser('returning')
  forgetDownloaded(c.template)
  await nextTick()
  openDetail('template', c.template)
}

export function closeCase(): void {
  if (caseOpen.value) proto.detail = null
}
