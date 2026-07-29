import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { nodeKey, scanCustomNodes } from './nodes'
import type { ScannedNode } from './nodes'

describe('nodeKey', () => {
  it('returns type:dirName format', () => {
    const node: ScannedNode = { id: 'my-node', type: 'cnr', dirName: 'my-node', enabled: true, version: '1.0' }
    expect(nodeKey(node)).toBe('cnr:my-node')
  })

  it('uses dirName not id for uniqueness', () => {
    const a: ScannedNode = { id: 'display-name', type: 'git', dirName: 'actual-dir', enabled: true }
    const b: ScannedNode = { id: 'other-name', type: 'git', dirName: 'actual-dir', enabled: true }
    expect(nodeKey(a)).toBe(nodeKey(b))
  })

  it('distinguishes nodes by type', () => {
    const cnr: ScannedNode = { id: 'node', type: 'cnr', dirName: 'node', enabled: true }
    const git: ScannedNode = { id: 'node', type: 'git', dirName: 'node', enabled: true }
    expect(nodeKey(cnr)).not.toBe(nodeKey(git))
  })
})

describe('scanCustomNodes', () => {
  let comfyuiDir: string
  let customNodesDir: string

  beforeEach(async () => {
    comfyuiDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodes-scan-'))
    customNodesDir = path.join(comfyuiDir, 'custom_nodes')
    await fs.promises.mkdir(customNodesDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.promises.rm(comfyuiDir, { recursive: true, force: true })
  })

  it('skips empty directories (accidentally created model dirs)', async () => {
    await fs.promises.mkdir(path.join(customNodesDir, 'checkpoints'))
    await fs.promises.mkdir(path.join(customNodesDir, 'loras'))
    expect(await scanCustomNodes(comfyuiDir)).toEqual([])
  })

  it('skips directories containing only non-Python content', async () => {
    const dir = path.join(customNodesDir, 'stray')
    await fs.promises.mkdir(path.join(dir, 'sub'), { recursive: true })
    await fs.promises.writeFile(path.join(dir, 'readme.txt'), 'hi')
    expect(await scanCustomNodes(comfyuiDir)).toEqual([])
  })

  it('captures unmanaged directories that contain top-level Python', async () => {
    const dir = path.join(customNodesDir, 'my-local-node')
    await fs.promises.mkdir(dir)
    await fs.promises.writeFile(path.join(dir, '__init__.py'), '')
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toEqual([{ id: 'my-local-node', type: 'git', dirName: 'my-local-node', enabled: true }])
  })

  it('captures unmanaged directories with only a pyproject.toml marker', async () => {
    const dir = path.join(customNodesDir, 'toml-only-node')
    await fs.promises.mkdir(path.join(dir, 'src'), { recursive: true })
    await fs.promises.writeFile(path.join(dir, 'pyproject.toml'), '[project]\nname = "toml-only-node"\n')
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toEqual([{ id: 'toml-only-node', type: 'git', dirName: 'toml-only-node', enabled: true }])
  })

  it('captures git directories even without top-level Python', async () => {
    const dir = path.join(customNodesDir, 'cloned-node')
    await fs.promises.mkdir(path.join(dir, '.git'), { recursive: true })
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id: 'cloned-node', type: 'git', enabled: true })
  })

  it('captures CNR directories via .tracking marker', async () => {
    const dir = path.join(customNodesDir, 'cnr-node')
    await fs.promises.mkdir(dir)
    await fs.promises.writeFile(path.join(dir, '.tracking'), '')
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id: 'cnr-node', type: 'cnr', enabled: true })
  })

  it('excludes the core websocket_image_save.py example but keeps other file nodes', async () => {
    await fs.promises.writeFile(path.join(customNodesDir, 'websocket_image_save.py'), '')
    await fs.promises.writeFile(path.join(customNodesDir, 'my_node.py'), '')
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toEqual([{ id: 'my_node.py', type: 'file', dirName: 'my_node.py', enabled: true }])
  })

  it('skips empty directories under .disabled too', async () => {
    const disabled = path.join(customNodesDir, '.disabled')
    await fs.promises.mkdir(path.join(disabled, 'empty'), { recursive: true })
    const withPy = path.join(disabled, 'real-node')
    await fs.promises.mkdir(withPy, { recursive: true })
    await fs.promises.writeFile(path.join(withPy, '__init__.py'), '')
    const nodes = await scanCustomNodes(comfyuiDir)
    expect(nodes).toEqual([{ id: 'real-node', type: 'git', dirName: 'real-node', enabled: false }])
  })
})
