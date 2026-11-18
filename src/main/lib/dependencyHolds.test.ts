import fs from 'fs'
import path from 'path'
import semver from 'semver'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface DependabotUpdate {
  'package-ecosystem': string
  ignore?: { 'dependency-name': string }[]
}

interface InstalledManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const repoRoot = process.cwd()
const DEPENDABOT_CONFIG = path.join('.github', 'dependabot.yml')

const HELD_FOR_A_KNOWN_REASON = [
  '@types/node',
  '@vueuse/core',
  '@xterm/addon-fit',
  '@xterm/xterm',
  'typescript'
]

function heldByDependabot(): string[] {
  const config = parse(fs.readFileSync(path.join(repoRoot, DEPENDABOT_CONFIG), 'utf-8')) as {
    updates: DependabotUpdate[]
  }
  const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm')
  return (npm?.ignore ?? []).map((entry) => entry['dependency-name']).sort()
}

function installedManifest(name: string): InstalledManifest {
  const file = path.join(repoRoot, 'node_modules', name, 'package.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as InstalledManifest
}

describe('dependencies Dependabot is told to hold back', () => {
  it('are only the ones with a known reason', () => {
    expect(heldByDependabot()).toEqual(HELD_FOR_A_KNOWN_REASON)
  })

  it('holds TypeScript below 6.1 only while typescript-eslint cannot lint newer versions', () => {
    const supported = installedManifest('typescript-eslint').peerDependencies?.typescript ?? ''

    expect(
      semver.satisfies('6.1.0', supported),
      `typescript-eslint now supports TypeScript 6.1: drop the typescript entry from ignore in ${DEPENDABOT_CONFIG} and the ~ range in package.json`
    ).toBe(false)
  })

  it('holds VueUse below 15 only while reka-ui depends on VueUse 14', () => {
    const required = installedManifest('reka-ui').dependencies?.['@vueuse/core'] ?? ''

    expect(
      semver.satisfies('15.0.0', required),
      `reka-ui now accepts VueUse 15: drop the @vueuse/core entry from ignore in ${DEPENDABOT_CONFIG}`
    ).toBe(false)
  })
})
