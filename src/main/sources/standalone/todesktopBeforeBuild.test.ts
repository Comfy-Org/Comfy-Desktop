import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises scripts/todesktop-beforeBuild.cjs, the last check standing between
// a short upload and a release that ships without a git backend (the 0.6.4
// post-mortem). It lives here because vitest only collects `src/**/*.test.ts`.
type BeforeBuildHook = (ctx: { appDir: string; platform: string; arch: string }) => Promise<void>

const repoRoot = process.cwd()
const hookPath = path.join(repoRoot, 'scripts', 'todesktop-beforeBuild.cjs')

interface ExtraResource {
  from: string
  to: string
}

async function loadHook(): Promise<BeforeBuildHook> {
  const mod = (await import(pathToFileURL(hookPath).href)) as { default: BeforeBuildHook }
  return mod.default
}

/** The `from` todesktop.json declares for a target, i.e. the only path whose
 *  contents reach the packaged app. */
function declaredFrom(platform: string, arch: string): string {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'todesktop.json'), 'utf-8')) as {
    extraResources?: ExtraResource[]
    targetOverrides?: Record<string, Record<string, { extraResources?: ExtraResource[] }>>
    platformOverrides?: Record<string, { extraResources?: ExtraResource[] }>
  }
  const lists = [
    config.targetOverrides?.[platform]?.[arch]?.extraResources,
    config.platformOverrides?.[platform]?.extraResources,
    config.extraResources
  ]
  for (const list of lists) {
    const entry = list?.find((resource) => resource.to === 'bootstrap-python')
    if (entry) return entry.from
  }
  throw new Error(`no bootstrap-python resource declared for ${platform}-${arch}`)
}

let tmpRoot: string
let appDir: string
let extraResources: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'todesktop-hook-'))
  appDir = path.join(tmpRoot, 'app-wrapper', 'app')
  extraResources = path.join(tmpRoot, 'app-wrapper', 'extraResources')
  fs.mkdirSync(appDir, { recursive: true })
  fs.mkdirSync(extraResources, { recursive: true })
  // The hook reads the real config to decide which path it must verify.
  fs.copyFileSync(path.join(repoRoot, 'todesktop.json'), path.join(appDir, 'todesktop.json'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function stageBootstrap(platform: string, arch: string, binaries: string[]): string {
  const destDir = path.join(extraResources, declaredFrom(platform, arch))
  for (const rel of binaries) {
    const file = path.join(destDir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
  }
  return destDir
}

describe('todesktop beforeBuild hook', () => {
  it('verifies the staged tree at the path todesktop.json declares', async () => {
    stageBootstrap('linux', 'x64', ['bin/python3', 'bin/uv'])
    const hook = await loadHook()

    // Resolves without network: a staged directory is never re-fetched.
    await expect(hook({ appDir, platform: 'linux', arch: 'x64' })).resolves.toBeUndefined()
  })

  it('verifies the Windows target at its own staged path', async () => {
    stageBootstrap('windows', 'arm64', ['python.exe', 'uv.exe'])
    const hook = await loadHook()

    await expect(hook({ appDir, platform: 'windows', arch: 'arm64' })).resolves.toBeUndefined()
  })

  it('fails the build when the staged tree arrived without its Python', async () => {
    // An upload that dropped the binary — the failure the hook exists to catch.
    stageBootstrap('linux', 'x64', ['bin/uv'])
    const hook = await loadHook()

    await expect(hook({ appDir, platform: 'linux', arch: 'x64' })).rejects.toThrow(/is missing/)
  })

  it('fails the build when the staged tree arrived without uv', async () => {
    stageBootstrap('linux', 'x64', ['bin/python3'])
    const hook = await loadHook()

    await expect(hook({ appDir, platform: 'linux', arch: 'x64' })).rejects.toThrow(/is missing/)
  })

  it('skips architectures that ship no bootstrap python', async () => {
    // Linux ARM64 ships a placeholder directory and no interpreter, so there
    // is nothing to verify and nothing to fetch.
    const hook = await loadHook()

    await expect(hook({ appDir, platform: 'linux', arch: 'arm64' })).resolves.toBeUndefined()
  })
})
