import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  packageManager?: string
  devDependencies?: Record<string, string>
}

interface ToDesktopConfig {
  pnpmVersion?: string
  packageJson?: { devDependencies?: Record<string, string | null> }
}

const repoRoot = process.cwd()

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf-8')) as T
}

describe('ToDesktop build pins', () => {
  const manifest = readJson<PackageManifest>('package.json')
  const todesktop = readJson<ToDesktopConfig>('todesktop.json')

  it('builds releases against the Electron version in package.json', () => {
    expect(
      todesktop.packageJson?.devDependencies?.electron,
      'electron changed in package.json: set packageJson.devDependencies.electron in todesktop.json to the same version'
    ).toBe(manifest.devDependencies?.electron)
  })

  it('installs release builds with the pnpm version in packageManager', () => {
    expect(
      `pnpm@${todesktop.pnpmVersion}`,
      'packageManager changed in package.json: set pnpmVersion in todesktop.json to the same version'
    ).toBe(manifest.packageManager?.split('+')[0])
  })
})
