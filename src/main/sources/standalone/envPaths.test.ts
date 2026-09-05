import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

import {
  writeComfyEnvironment,
  getTorchVersion,
  getVariantLabel,
  isArm64Variant,
  isBetaVariant,
  recommendVariant,
  stripPlatform,
  variantAccel,
  variantMatchesHost,
  variantMatchesHostArch
} from './envPaths'
import type { InstallationRecord } from '../../installations'

const ENV_FILENAME = '.comfy_environment'
const EXPECTED_CONTENT = 'local-desktop2-standalone\n'

/** Build the platform-appropriate site-packages dir under a managed venv and return it. */
function makeSitePackages(installPath: string): string {
  const venv = path.join(installPath, 'ComfyUI', '.venv')
  const sitePackages =
    process.platform === 'win32'
      ? path.join(venv, 'Lib', 'site-packages')
      : path.join(venv, 'lib', 'python3.12', 'site-packages')
  fs.mkdirSync(sitePackages, { recursive: true })
  return sitePackages
}

describe('writeComfyEnvironment', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-env-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('writes the marker file with local-desktop2-standalone content + trailing newline', async () => {
    await writeComfyEnvironment(tmpDir)
    const written = fs.readFileSync(path.join(tmpDir, ENV_FILENAME), 'utf-8')
    expect(written).toBe(EXPECTED_CONTENT)
  })

  it('is idempotent — does not rewrite when content already matches', async () => {
    const filePath = path.join(tmpDir, ENV_FILENAME)
    await writeComfyEnvironment(tmpDir)
    const mtimeBefore = fs.statSync(filePath).mtimeMs
    // Wait a tick so mtime would change if a write actually happened.
    await new Promise((r) => setTimeout(r, 20))
    await writeComfyEnvironment(tmpDir)
    const mtimeAfter = fs.statSync(filePath).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it('rewrites when existing content differs', async () => {
    const filePath = path.join(tmpDir, ENV_FILENAME)
    fs.writeFileSync(filePath, 'something_else\n', 'utf-8')
    await writeComfyEnvironment(tmpDir)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(EXPECTED_CONTENT)
  })

  it('skips silently when the target directory does not exist', async () => {
    const missingDir = path.join(tmpDir, 'does-not-exist')
    await expect(writeComfyEnvironment(missingDir)).resolves.toBeUndefined()
    expect(fs.existsSync(path.join(missingDir, ENV_FILENAME))).toBe(false)
  })

  it('swallows write errors and warns instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // tmpDir exists, but we pre-create the marker as a directory so writeFile fails with EISDIR.
    fs.mkdirSync(path.join(tmpDir, ENV_FILENAME))
    await expect(writeComfyEnvironment(tmpDir)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('getTorchVersion', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-torch-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  function install(): InstallationRecord {
    return { id: 'i', name: 'i', installPath: tmpDir } as unknown as InstallationRecord
  }

  it('reads the version from the torch dist-info directory', () => {
    const sitePackages = makeSitePackages(tmpDir)
    fs.mkdirSync(path.join(sitePackages, 'torch-2.5.1+cu121.dist-info'))
    expect(getTorchVersion(install())).toBe('2.5.1+cu121')
  })

  it('returns null when torch is not installed', () => {
    const sitePackages = makeSitePackages(tmpDir)
    fs.mkdirSync(path.join(sitePackages, 'numpy-1.26.4.dist-info'))
    expect(getTorchVersion(install())).toBeNull()
  })

  it('returns null when the venv does not exist', () => {
    expect(getTorchVersion(install())).toBeNull()
  })
})

// --- Windows ARM64 vendor ids (win-nvidia-arm64: NVIDIA RTX Spark) ---

describe('Windows ARM64 vendor ids', () => {
  const realPlatform = process.platform
  const realArch = process.arch
  function setHost(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
    Object.defineProperty(process, 'platform', { value: platform })
    Object.defineProperty(process, 'arch', { value: arch })
  }
  afterEach(() => setHost(realPlatform, realArch))

  it('isArm64Variant recognises the -arm64 suffix only', () => {
    expect(isArm64Variant('win-nvidia-arm64')).toBe(true)
    expect(isArm64Variant('nvidia-arm64')).toBe(true)
    expect(isArm64Variant('win-nvidia')).toBe(false)
    expect(isArm64Variant('mac-mps')).toBe(false)
  })

  it('variantAccel strips the platform prefix and the architecture suffix', () => {
    expect(variantAccel('win-nvidia-arm64')).toBe('nvidia')
    expect(variantAccel('win-nvidia')).toBe('nvidia')
    expect(variantAccel('win-intel-xpu')).toBe('intel-xpu')
    expect(variantAccel('mac-mps')).toBe('mps')
    expect(variantAccel('linux-cpu')).toBe('cpu')
  })

  it('labels and recommends the ARM64 NVIDIA bundle like its x64 sibling', () => {
    expect(getVariantLabel('win-nvidia-arm64')).toBe('NVIDIA (ARM64)')
    expect(getVariantLabel('win-nvidia')).toBe('NVIDIA')
    expect(recommendVariant('win-nvidia-arm64', 'nvidia')).toBe(true)
    expect(recommendVariant('win-nvidia-arm64', 'amd')).toBe(false)
    expect(recommendVariant('win-nvidia-arm64', undefined)).toBe(false)
  })

  it('a beta- id strips, resolves and recommends like its final id, labelled Beta', () => {
    // beta- hides a pre-release bundle from desktops that filter on the bare
    // platform prefix; this build reads through it.
    expect(isBetaVariant('beta-win-nvidia-arm64')).toBe(true)
    expect(isBetaVariant('win-nvidia-arm64')).toBe(false)
    expect(stripPlatform('beta-win-nvidia-arm64')).toBe('nvidia-arm64')
    expect(variantAccel('beta-win-nvidia-arm64')).toBe('nvidia')
    expect(isArm64Variant('beta-win-nvidia-arm64')).toBe(true)
    expect(getVariantLabel('beta-win-nvidia-arm64')).toBe('NVIDIA (ARM64) Beta')
    expect(getVariantLabel('beta-win-cpu')).toBe('CPU Beta')
    expect(recommendVariant('beta-win-nvidia-arm64', 'nvidia')).toBe(true)
    expect(recommendVariant('beta-win-nvidia-arm64', 'amd')).toBe(false)
  })

  describe('variantMatchesHostArch', () => {
    it('a native ARM64 Windows app sees only -arm64 bundles', () => {
      setHost('win32', 'arm64')
      expect(variantMatchesHostArch('win-nvidia-arm64')).toBe(true)
      expect(variantMatchesHostArch('win-nvidia')).toBe(false)
      expect(variantMatchesHostArch('win-cpu')).toBe(false)
    })

    it('an x64 Windows app never sees -arm64 bundles (also under Prism emulation on an ARM64 machine)', () => {
      setHost('win32', 'x64')
      expect(variantMatchesHostArch('win-nvidia')).toBe(true)
      expect(variantMatchesHostArch('win-cpu')).toBe(true)
      expect(variantMatchesHostArch('win-nvidia-arm64')).toBe(false)
    })

    it('macOS is ARM64 without a suffix: unsuffixed ids match, suffixed ones never do', () => {
      setHost('darwin', 'arm64')
      expect(variantMatchesHostArch('mac-mps')).toBe(true)
      expect(variantMatchesHostArch('mac-mps-arm64')).toBe(false)
    })

    it('linux has no per-architecture bundles', () => {
      setHost('linux', 'x64')
      expect(variantMatchesHostArch('linux-nvidia')).toBe(true)
      expect(variantMatchesHostArch('linux-nvidia-arm64')).toBe(false)
    })
  })

  describe('variantMatchesHost', () => {
    it('accepts the beta- prefix only directly in front of the host platform', () => {
      setHost('win32', 'arm64')
      expect(variantMatchesHost('beta-win-nvidia-arm64')).toBe(true)
      expect(variantMatchesHost('win-nvidia-arm64')).toBe(true)
      expect(variantMatchesHost('beta-mac-mps')).toBe(false)
      expect(variantMatchesHost('betawin-nvidia-arm64')).toBe(false)
      expect(variantMatchesHost('beta-beta-win-nvidia-arm64')).toBe(false)
    })

    it('still applies the architecture rule to beta ids', () => {
      setHost('win32', 'x64')
      expect(variantMatchesHost('beta-win-nvidia-arm64')).toBe(false)
      expect(variantMatchesHost('beta-win-nvidia')).toBe(true)
      expect(variantMatchesHost('win-nvidia')).toBe(true)
    })

    it('rejects every id on an unsupported platform', () => {
      setHost('freebsd', 'x64')
      expect(variantMatchesHost('win-nvidia')).toBe(false)
      expect(variantMatchesHost('beta-win-nvidia')).toBe(false)
    })
  })
})
