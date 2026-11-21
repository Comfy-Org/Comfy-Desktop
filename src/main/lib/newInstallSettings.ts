import fs from 'fs'
import path from 'path'
import type { InstallationRecord } from '../installations'

const COMFY_SETTINGS_FILE = 'comfy.settings.json'
const VUE_NODES_SETTING = 'Comfy.VueNodes.Enabled'
const SEEDED_SOURCES = new Set(['standalone', 'comfybuilder'])

export function defaultComfySettingsPath(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'user', 'default', COMFY_SETTINGS_FILE)
}

// The PyPI frontend these installs run defaults Nodes 2.0 off; only its Cloud and legacy
// Desktop builds turn it on for new users. A stored value wins over that default, and a
// file holding only this key still counts as a new user, so onboarding runs as before.
export async function seedNewInstallComfySettings(installation: InstallationRecord): Promise<void> {
  if (!SEEDED_SOURCES.has(installation.sourceId)) return
  const filePath = defaultComfySettingsPath(installation.installPath)
  try {
    let current: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      current = parsed as Record<string, unknown>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return
    }
    if (VUE_NODES_SETTING in current) return
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(
      filePath,
      JSON.stringify({ ...current, [VUE_NODES_SETTING]: true }, null, 4),
      'utf-8'
    )
  } catch (err) {
    console.warn('Failed to write the new install frontend settings:', err)
  }
}
