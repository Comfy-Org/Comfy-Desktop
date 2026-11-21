import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultComfySettingsPath, seedNewInstallComfySettings } from './newInstallSettings'
import type { InstallationRecord } from '../installations'

describe('seedNewInstallComfySettings', () => {
  let root: string
  let settingsPath: string

  const install = (sourceId = 'standalone'): InstallationRecord =>
    ({
      id: 'inst-1',
      name: 'ComfyUI',
      createdAt: new Date(0).toISOString(),
      installPath: root,
      sourceId
    }) as InstallationRecord

  const writeSettings = (content: string): void => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, content)
  }

  const readSettings = (): unknown => JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-install-settings-'))
    settingsPath = defaultComfySettingsPath(root)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('turns Nodes 2.0 on in the default user settings of a new install', async () => {
    await seedNewInstallComfySettings(install())

    expect(settingsPath).toBe(path.join(root, 'ComfyUI', 'user', 'default', 'comfy.settings.json'))
    expect(readSettings()).toEqual({ 'Comfy.VueNodes.Enabled': true })
  })

  it('turns Nodes 2.0 on for a Workspace build install', async () => {
    await seedNewInstallComfySettings(install('comfybuilder'))

    expect(readSettings()).toEqual({ 'Comfy.VueNodes.Enabled': true })
  })

  it('writes nothing for a source the frontend default is not changed for', async () => {
    await seedNewInstallComfySettings(install('portable'))

    expect(fs.existsSync(settingsPath)).toBe(false)
  })

  it('adds the setting next to the ones the download already has', async () => {
    writeSettings(JSON.stringify({ 'Comfy.Locale': 'fr' }))

    await seedNewInstallComfySettings(install())

    expect(readSettings()).toEqual({ 'Comfy.Locale': 'fr', 'Comfy.VueNodes.Enabled': true })
  })

  it('keeps a Nodes 2.0 value that is already set', async () => {
    const existing = JSON.stringify({ 'Comfy.VueNodes.Enabled': false })
    writeSettings(existing)

    await seedNewInstallComfySettings(install())

    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(existing)
  })

  it('leaves a settings file it cannot read as JSON untouched', async () => {
    writeSettings('{ not json')

    await seedNewInstallComfySettings(install())

    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ not json')
  })

  it('finishes without throwing when the settings file cannot be written', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('EACCES'))
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(seedNewInstallComfySettings(install())).resolves.toBeUndefined()
    expect(warned).toHaveBeenCalled()
  })
})
