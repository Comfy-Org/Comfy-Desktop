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

interface PackageManifest {
  engines?: { node?: string }
  devDependencies?: Record<string, string>
}

const repoRoot = process.cwd()
const workflowsDir = path.join(repoRoot, '.github', 'workflows')

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf-8')
}

function pinnedNodeVersion(): string {
  return readRepoFile('.nvmrc').trim()
}

function majorOf(version: string): string {
  return version.replace(/^[^\d]*/, '').split('.')[0] ?? ''
}

function packageManifest(): PackageManifest {
  return JSON.parse(readRepoFile('package.json')) as PackageManifest
}

function setupNodeSteps(): { file: string; step: WorkflowStep }[] {
  return fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) => {
      const workflow = parse(readRepoFile('.github', 'workflows', file)) as Workflow
      return Object.values(workflow.jobs ?? {}).flatMap((job) =>
        (job.steps ?? [])
          .filter((step) => step.uses?.startsWith('actions/setup-node@'))
          .map((step) => ({ file, step }))
      )
    })
}

describe('Node version pin', () => {
  it('pins an exact Node version in .nvmrc', () => {
    expect(pinnedNodeVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('builds ToDesktop releases on the .nvmrc version', () => {
    const todesktop = JSON.parse(readRepoFile('todesktop.json')) as { nodeVersion?: string }

    expect(todesktop.nodeVersion).toBe(pinnedNodeVersion())
  })

  it('sets up Node from .nvmrc in every workflow', () => {
    const steps = setupNodeSteps()
    expect(steps.length).toBeGreaterThan(0)

    const offPin = steps
      .filter(
        ({ step }) =>
          step.with?.['node-version-file'] !== '.nvmrc' || 'node-version' in (step.with ?? {})
      )
      .map(({ file }) => file)

    expect(offPin).toEqual([])
  })

  it('declares an engines floor on the pinned Node major', () => {
    const floor = packageManifest().engines?.node ?? ''

    expect(floor.startsWith('>=')).toBe(true)
    expect(majorOf(floor)).toBe(majorOf(pinnedNodeVersion()))
  })

  it('type-checks against the pinned Node major', () => {
    const nodeTypes = packageManifest().devDependencies?.['@types/node'] ?? ''

    expect(majorOf(nodeTypes)).toBe(majorOf(pinnedNodeVersion()))
  })
})
