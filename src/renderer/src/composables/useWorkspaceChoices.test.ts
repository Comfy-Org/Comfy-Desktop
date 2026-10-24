import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceChoices } from './useWorkspaceChoices'
import { useAuthStore } from '../stores/authStore'
import { PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
Object.defineProperty(window, 'api', {
  value: {
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: true }),
      onAuthChanged: vi.fn(() => () => {})
    }
  },
  configurable: true
})

function setup(workspaceId: string) {
  let api!: ReturnType<typeof useWorkspaceChoices>
  mount(
    defineComponent({
      setup() {
        api = useWorkspaceChoices(ref(workspaceId))
        return () => h('div')
      }
    })
  )
  return api
}

describe('useWorkspaceChoices', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const store = useAuthStore()
    store.status = { signedIn: true }
    // Signing in clears the list; give it the workspaces after that.
    await nextTick()
    store.workspaces = [
      {
        id: 'p',
        name: 'Personal Workspace',
        type: 'personal',
        role: 'OWNER',
        subscriptionTier: 'CREATOR'
      },
      { id: 't', name: 'Design Team', type: 'team', role: 'member', subscriptionTier: 'galaxy' }
    ]
  })

  it('offers Personal first, then the team workspaces, each with its plan', () => {
    expect(setup(PERSONAL_WORKSPACE_ID).workspaceChoices.value).toEqual([
      {
        id: PERSONAL_WORKSPACE_ID,
        label: 'devPlatform.workspace.personalLabel',
        tier: 'buildsDashboard.account.tier.creator'
      },
      // An unknown plan shows as Cloud sent it.
      { id: 't', label: 'Design Team', tier: 'galaxy' }
    ])
  })

  it("names the selected workspace's plan and role, and lets only its owner manage the plan", () => {
    const personal = setup(PERSONAL_WORKSPACE_ID)
    expect(personal.currentMeta.value).toEqual([
      'buildsDashboard.account.tier.creator',
      'buildsDashboard.account.role.owner'
    ])
    expect(personal.canManagePlan.value).toBe(true)
    expect(setup('t').canManagePlan.value).toBe(false)
  })

  it('reads a plan or role Cloud sends as something other than text as unknown', () => {
    const store = useAuthStore()
    store.workspaces = [
      { id: 't', name: 'Odd', type: 'team', role: 7, subscriptionTier: {} } as never
    ]
    const odd = setup('t')
    expect(odd.currentMeta.value).toEqual([])
    expect(odd.canManagePlan.value).toBe(false)
  })
})
