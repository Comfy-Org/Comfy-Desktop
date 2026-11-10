import fs from 'fs'
import path from 'path'
import { parse as parseToml } from 'smol-toml'
import { hasGitDir, readGitHead, readGitRemoteUrl } from './git'

export interface ScannedNode {
  id: string
  type: 'cnr' | 'git' | 'file'
  dirName: string
  enabled: boolean
  version?: string
  commit?: string
  url?: string
}

export function nodeKey(node: ScannedNode): string {
  return `${node.type}:${node.dirName}`
}

function readTomlProjectField(tomlPath: string, field: string): string | null {
  try {
    const content = fs.readFileSync(tomlPath, 'utf-8')
    const parsed = parseToml(content)
    const value = (parsed.project as Record<string, unknown> | undefined)?.[field]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function hasTopLevelPython(nodePath: string): boolean {
  try {
    return fs.readdirSync(nodePath).some((name) => name.endsWith('.py'))
  } catch {
    return false
  }
}

function identifyNode(nodePath: string): Omit<ScannedNode, 'enabled'> | null {
  const dirName = path.basename(nodePath)
  const trackingPath = path.join(nodePath, '.tracking')
  const tomlPath = path.join(nodePath, 'pyproject.toml')

  if (fs.existsSync(trackingPath)) {
    const id = readTomlProjectField(tomlPath, 'name') || dirName
    const version = readTomlProjectField(tomlPath, 'version') || undefined
    return { id, type: 'cnr', dirName, version }
  }

  if (hasGitDir(nodePath)) {
    const commit = readGitHead(nodePath) || undefined
    const url = readGitRemoteUrl(nodePath) || undefined
    return { id: dirName, type: 'git', dirName, commit, url }
  }

  if (fs.existsSync(tomlPath) || hasTopLevelPython(nodePath)) {
    return { id: dirName, type: 'git', dirName }
  }
  return null
}

const CORE_FILE_NODES = new Set(['websocket_image_save.py'])

export async function scanCustomNodes(comfyuiDir: string): Promise<ScannedNode[]> {
  const customNodesDir = path.join(comfyuiDir, 'custom_nodes')
  const disabledDir = path.join(customNodesDir, '.disabled')
  const nodes: ScannedNode[] = []

  try {
    const entries = await fs.promises.readdir(customNodesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
      const fullPath = path.join(customNodesDir, entry.name)
      if (entry.isDirectory()) {
        const identified = identifyNode(fullPath)
        if (identified) nodes.push({ ...identified, enabled: true })
      } else if (entry.name.endsWith('.py') && !CORE_FILE_NODES.has(entry.name)) {
        nodes.push({ id: entry.name, type: 'file', dirName: entry.name, enabled: true })
      }
    }
  } catch {}

  try {
    const entries = await fs.promises.readdir(disabledDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
      if (entry.isDirectory()) {
        const identified = identifyNode(path.join(disabledDir, entry.name))
        if (identified) nodes.push({ ...identified, enabled: false })
      }
    }
  } catch {}

  return nodes
}
