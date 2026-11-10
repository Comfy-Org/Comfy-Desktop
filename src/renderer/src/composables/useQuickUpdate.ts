import { useDetailActionPreflight } from './useDetailActionPreflight'
import { currentChannelValue, findActionById } from '../lib/findAction'
import type { ActionDef, Installation, ShowProgressOpts } from '../types/ipc'

export const QUICK_UPDATE_ACTION_ID = 'update-comfyui'

export interface QuickUpdateOpts {
  onShowProgress: (opts: ShowProgressOpts) => void
  onUnavailable: (inst: Installation) => void
}

async function findQuickUpdateAction(inst: Installation): Promise<ActionDef | null> {
  try {
    const sections = await window.api.getDetailSections(inst.id)
    const action = findActionById(sections, QUICK_UPDATE_ACTION_ID, currentChannelValue(sections))
    return action && action.enabled !== false && action.showProgress ? action : null
  } catch {
    return null
  }
}

export function useQuickUpdate(opts: QuickUpdateOpts) {
  const { prepareDetailAction, showDetailActionProgress } = useDetailActionPreflight()

  async function runQuickUpdate(inst: Installation): Promise<void> {
    const action = await findQuickUpdateAction(inst)
    if (!action) {
      opts.onUnavailable(inst)
      return
    }
    const prepared = await prepareDetailAction(inst, action)
    if (!prepared) return
    showDetailActionProgress(inst, prepared, {
      returnTo: 'list',
      onShowProgress: opts.onShowProgress
    })
  }

  return { runQuickUpdate }
}
