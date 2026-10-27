import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  uses?: string
  with?: Record<string, unknown>
}

interface Workflow {
  jobs?: Record<string, { steps?: WorkflowStep[] }>
}

const repoRoot = process.cwd()
const workflowsDir = path.join(repoRoot, '.github', 'workflows')

// npm trusted publishing needs an npm CLI newer than the pinned Node ships.
const HARDCODED_NODE_ALLOWED = new Set(['publish-bridge-types.yml'])

function readNvmrc(): string {
  return fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf-8').trim()
}

function setupNodeSteps(): { file: string; step: WorkflowStep }[] {
  return fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) => {
      const workflow = parse(fs.readFileSync(path.join(workflowsDir, file), 'utf-8')) as Workflow
      return Object.values(workflow.jobs ?? {}).flatMap((job) =>
        (job.steps ?? [])
          .filter((step) => step.uses?.startsWith('actions/setup-node@'))
          .map((step) => ({ file, step }))
      )
    })
}

describe('Node version pin', () => {
  it('pins an exact Node version in .nvmrc', () => {
    expect(readNvmrc()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('builds ToDesktop releases on the .nvmrc version', () => {
    const todesktop = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'todesktop.json'), 'utf-8')
    ) as { nodeVersion?: string }

    expect(todesktop.nodeVersion).toBe(readNvmrc())
  })

  it('sets up Node in CI from .nvmrc', () => {
    const steps = setupNodeSteps()
    expect(steps.length).toBeGreaterThan(0)

    const offPin = steps
      .filter(({ file }) => !HARDCODED_NODE_ALLOWED.has(file))
      .filter(({ step }) => step.with?.['node-version-file'] !== '.nvmrc')
      .map(({ file }) => file)

    expect(offPin).toEqual([])
  })
})
