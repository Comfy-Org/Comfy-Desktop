import { describe, expect, it } from 'vitest'
import type { CatalogWorkflow, CatalogWorkflowNeeds, Installation } from '../types/ipc'
import { bestChoice, knownBytes, targetChoices, type TargetContext } from './workflowTargets'

const WORKFLOW = {
  id: 'ltx',
  canOpenLocal: true,
  canOpenCloud: true,
  minComfyUIVersion: '0.3.66'
} as CatalogWorkflow

function local(id: string, lastLaunchedAt = 0): Installation {
  return {
    id,
    name: id,
    sourceId: 'standalone',
    sourceLabel: 'Local',
    sourceCategory: 'local',
    status: 'installed',
    lastLaunchedAt
  }
}
const CLOUD: Installation = {
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Comfy Cloud',
  sourceCategory: 'cloud'
}
const NEEDS: CatalogWorkflowNeeds = {
  graph: null,
  models: [
    { filename: 'ltx_fp8.safetensors', directory: 'diffusion_models', sizeBytes: 33_700_000_000 },
    { filename: 'ltx_vae.safetensors', directory: 'vae', sizeBytes: 300_000_000 }
  ],
  missingByBuild: { lab: [], sandbox: ['ltx_fp8.safetensors', 'ltx_vae.safetensors'], old: [] }
}

function context(over: Partial<TargetContext> = {}): TargetContext {
  return {
    workflow: WORKFLOW,
    installations: [local('sandbox', 3), local('lab', 2), local('old', 1), CLOUD],
    versions: { sandbox: '0.3.70', lab: '0.3.66', old: '0.3.60' },
    needs: NEEDS,
    isRunning: () => false,
    signedIn: true,
    online: true,
    ...over
  }
}

describe('where a catalog workflow can open', () => {
  it('lists local builds by last use, then Comfy Cloud, each with what it lacks', () => {
    const choices = targetChoices(context())

    expect(choices.map(({ key, state }) => [key, state])).toEqual([
      ['local:sandbox', 'missing'],
      ['local:lab', 'ready'],
      ['local:old', 'outdated'],
      ['cloud', 'cloud-ready']
    ])
    expect(knownBytes(choices[0]!.missing)).toBe(34_000_000_000)
    expect(choices[2]!.disabled).toBe(true)
  })

  it('picks a running build with every model, then one with every model, then Cloud', () => {
    expect(bestChoice(targetChoices(context()))?.key).toBe('local:lab')
    expect(bestChoice(targetChoices(context({ isRunning: (id) => id === 'sandbox' })))?.key).toBe(
      'local:lab'
    )
    expect(
      bestChoice(
        targetChoices(
          context({
            needs: {
              ...NEEDS,
              missingByBuild: {
                lab: ['ltx_vae.safetensors'],
                sandbox: ['ltx_vae.safetensors'],
                old: []
              }
            }
          })
        )
      )?.key
    ).toBe('cloud')
  })

  it('says why Cloud cannot run it yet: not published there, offline, or signed out', () => {
    const cloudState = (over: Partial<TargetContext>) =>
      targetChoices(context(over)).find(({ key }) => key === 'cloud')
    expect(cloudState({ workflow: { ...WORKFLOW, canOpenCloud: false } })).toMatchObject({
      state: 'not-on-cloud',
      disabled: true
    })
    expect(cloudState({ online: false })?.state).toBe('offline')
    expect(cloudState({ signedIn: false })?.state).toBe('signed-out')
  })

  it('offers only Comfy Cloud for a partner workflow', () => {
    expect(
      targetChoices(context({ workflow: { ...WORKFLOW, canOpenLocal: false } })).map(
        ({ key }) => key
      )
    ).toEqual(['cloud'])
  })

  it('waits for the model check before saying a build is ready', () => {
    expect(targetChoices(context({ needs: undefined }))[1]?.state).toBe('checking')
  })
})
