import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let stagedInstallPath = ''
let comfyOriginPath = ''
let nodeOriginPath = ''
let workTmpPath = ''

let comfyCommitA = ''
let comfyCommitB = ''
let nodeCommitA = ''
let nodeCommitB = ''

const INSTALL_ID = 'inst-snapshot-restore'
const INSTALL_NAME = 'Snapshot Restore Test'
const NODE_DIRNAME = 'restore-test-node'
const SEEDED_BASE_TAG = 'v0.3.10'

interface SnapshotSummary {
  filename: string
  trigger: string
  label: string | null
  [key: string]: unknown
}

interface SnapshotListResult {
  snapshots: SnapshotSummary[]
  totalCount: number
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Lifecycle Test',
      GIT_AUTHOR_EMAIL: 'lifecycle@example.com',
      GIT_COMMITTER_NAME: 'Lifecycle Test',
      GIT_COMMITTER_EMAIL: 'lifecycle@example.com'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8'
  }).trim()
}

async function buildTwoCommitRepo(
  root: string,
  name: string,
  firstFile: { name: string; content: string },
  secondFile: { name: string; content: string }
): Promise<{ originPath: string; commitA: string; commitB: string }> {
  const originPath = path.join(root, `${name}.git`)
  await mkdir(originPath, { recursive: true })
  gitIn(originPath, ['init', '--quiet', '--bare', '--initial-branch=master'])

  const workPath = path.join(root, `${name}-work`)
  await mkdir(workPath, { recursive: true })
  gitIn(workPath, ['init', '--quiet', '--initial-branch=master'])
  gitIn(workPath, ['remote', 'add', 'origin', originPath])

  await writeFile(path.join(workPath, firstFile.name), firstFile.content)
  gitIn(workPath, ['add', '.'])
  gitIn(workPath, ['commit', '--quiet', '-m', 'A: initial'])
  const commitA = gitIn(workPath, ['rev-parse', 'HEAD'])
  gitIn(workPath, ['push', '--quiet', 'origin', 'master'])

  await writeFile(path.join(workPath, secondFile.name), secondFile.content)
  gitIn(workPath, ['add', '.'])
  gitIn(workPath, ['commit', '--quiet', '-m', 'B: follow-up'])
  const commitB = gitIn(workPath, ['rev-parse', 'HEAD'])
  gitIn(workPath, ['push', '--quiet', 'origin', 'master'])

  return { originPath, commitA, commitB }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  workTmpPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-restore-e2e-'))

  const comfy = await buildTwoCommitRepo(
    workTmpPath,
    'comfyui-origin',
    { name: 'README.md', content: 'comfyui v1\n' },
    { name: 'README.md', content: 'comfyui v2\n' }
  )
  comfyOriginPath = comfy.originPath
  comfyCommitA = comfy.commitA
  comfyCommitB = comfy.commitB

  const node = await buildTwoCommitRepo(
    workTmpPath,
    'restore-node-origin',
    { name: 'node.py', content: '# v1\n' },
    { name: 'node.py', content: '# v2\n' }
  )
  nodeOriginPath = node.originPath
  nodeCommitA = node.commitA
  nodeCommitB = node.commitB

  stagedInstallPath = path.join(workTmpPath, 'install')
  await mkdir(stagedInstallPath, { recursive: true })

  const comfyuiDir = path.join(stagedInstallPath, 'ComfyUI')
  gitIn(workTmpPath, ['clone', '--quiet', comfyOriginPath, comfyuiDir])
  gitIn(comfyuiDir, ['checkout', '--quiet', comfyCommitB])

  const customNodesDir = path.join(comfyuiDir, 'custom_nodes')
  await mkdir(customNodesDir, { recursive: true })
  const stagedNodeDir = path.join(customNodesDir, NODE_DIRNAME)
  gitIn(customNodesDir, ['clone', '--quiet', nodeOriginPath, NODE_DIRNAME])
  gitIn(stagedNodeDir, ['checkout', '--quiet', nodeCommitB])

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath: stagedInstallPath,
        sourceId: 'standalone',
        status: 'installed',
        snapshots: [
          {
            trigger: 'manual',
            label: 'restore-target',
            createdAt: '2026-01-01T00:00:00.000Z',
            comfyui: {
              ref: comfyCommitA,
              commit: comfyCommitA,
              releaseTag: SEEDED_BASE_TAG,
              variant: 'cpu',
              baseTag: SEEDED_BASE_TAG,
              commitsAhead: 0
            },
            customNodes: [
              {
                id: NODE_DIRNAME,
                type: 'git',
                dirName: NODE_DIRNAME,
                enabled: true,
                commit: nodeCommitA,
                url: nodeOriginPath
              }
            ],
            pipPackages: {},
            skipPipSync: true,
            updateChannel: 'stable'
          },
          {
            trigger: 'manual',
            label: 'current-state',
            createdAt: '2026-01-02T00:00:00.000Z',
            comfyui: {
              ref: comfyCommitB,
              commit: comfyCommitB,
              releaseTag: SEEDED_BASE_TAG,
              variant: 'cpu',
              baseTag: SEEDED_BASE_TAG,
              commitsAhead: 1
            },
            customNodes: [
              {
                id: NODE_DIRNAME,
                type: 'git',
                dirName: NODE_DIRNAME,
                enabled: true,
                commit: nodeCommitB,
                url: nodeOriginPath
              }
            ],
            pipPackages: {},
            skipPipSync: true,
            updateChannel: 'stable'
          }
        ]
      }
    ]
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (workTmpPath) await rm(workTmpPath, { recursive: true, force: true })
})

test('seeded HEADs start at commit B (sanity) @lifecycle @windows @macos @linux', async () => {
  const comfyHead = gitIn(path.join(stagedInstallPath, 'ComfyUI'), ['rev-parse', 'HEAD'])
  const nodeHead = gitIn(path.join(stagedInstallPath, 'ComfyUI', 'custom_nodes', NODE_DIRNAME), [
    'rev-parse',
    'HEAD'
  ])
  expect(comfyHead).toBe(comfyCommitB)
  expect(nodeHead).toBe(nodeCommitB)
})

test('snapshot-restore moves ComfyUI + node HEAD back to commit A @lifecycle @windows @macos @linux', async () => {
  const list = await ctx.panel.evaluate<SnapshotListResult>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)})`
  )
  expect(list.snapshots.length, 'no seeded snapshot found').toBeGreaterThan(0)
  const target = list.snapshots.find((s) => s.trigger === 'manual' && s.label === 'restore-target')
  expect(target, 'seeded restore-target snapshot missing from list').toBeDefined()

  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  await popup.waitForSelector(byTestId(TID.snapshotRow(target!.filename)), { timeout: 30_000 })
  expect(await popup.click(byTestId(TID.snapshotRow(target!.filename)))).toBe(true)
  await popup.waitForVisible(byTestId(TID.snapshotRowRestore(target!.filename)), {
    timeout: 10_000
  })
  expect(await popup.click(byTestId(TID.snapshotRowRestore(target!.filename)))).toBe(true)

  const confirmSelector = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await expect
    .poll(
      async () =>
        popup.evaluate<boolean>(
          `!!document.querySelector('.snapshots-rail-save-box.is-op-success')`
        ),
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe(true)

  const comfyHead = gitIn(path.join(stagedInstallPath, 'ComfyUI'), ['rev-parse', 'HEAD'])
  expect(comfyHead, 'ComfyUI HEAD did not move to commit A after restore').toBe(comfyCommitA)

  const nodeHead = gitIn(path.join(stagedInstallPath, 'ComfyUI', 'custom_nodes', NODE_DIRNAME), [
    'rev-parse',
    'HEAD'
  ])
  expect(nodeHead, 'custom node HEAD did not move to commit A after restore').toBe(nodeCommitA)

  await closeTitlePopupIfOpen(ctx.app)
})

test('restore captures a post-restore snapshot @lifecycle @windows @macos @linux', async () => {
  await expect
    .poll(
      async () =>
        ctx.panel.evaluate<SnapshotListResult>(
          `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)})`
        ),
      { timeout: 10_000, intervals: [200, 500] }
    )
    .toMatchObject({
      snapshots: expect.arrayContaining([
        expect.objectContaining({ trigger: 'post-restore' })
      ]) as unknown
    })
})

test('picker-driven restore surfaces inline op-card + auto-dismisses on success @lifecycle', async () => {
  test.setTimeout(120_000)

  const list = await ctx.panel.evaluate<SnapshotListResult>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)})`
  )
  const target = list.snapshots.find((s) => s.trigger === 'manual' && s.label === 'current-state')
  expect(target, 'seeded current-state snapshot missing from list').toBeDefined()

  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  await popup.waitForSelector(byTestId(TID.snapshotRow(target!.filename)), { timeout: 30_000 })
  expect(await popup.click(byTestId(TID.snapshotRow(target!.filename)))).toBe(true)
  await popup.waitForVisible(byTestId(TID.snapshotRowRestore(target!.filename)), {
    timeout: 10_000
  })
  expect(await popup.click(byTestId(TID.snapshotRowRestore(target!.filename)))).toBe(true)

  const confirmSelector = '[data-testid="modal-confirm-button"], [data-testid="base-alert-action"]'
  await popup.waitForVisible(confirmSelector, { timeout: 15_000 })
  expect(await popup.click(confirmSelector)).toBe(true)

  await popup.waitForVisible(byTestId(TID.snapshotsOpCard), { timeout: 15_000 })

  const labelText = await popup.evaluate<string>(
    `document.querySelector('.snapshots-rail-node.is-save .snapshots-rail-label')?.textContent ?? ''`
  )
  expect(labelText.trim()).toMatch(/Restoring snapshot|Snapshot restored/i)

  await expect
    .poll(
      async () =>
        popup.evaluate<boolean>(
          `!!document.querySelector('.snapshots-rail-save-box.is-op-success')`
        ),
      { timeout: 60_000, intervals: [500, 1_000] }
    )
    .toBe(true)

  await expect
    .poll(async () => popup.evaluate<boolean>(`!!document.querySelector('.snapshots-rail-cta')`), {
      timeout: 8_000,
      intervals: [200, 400]
    })
    .toBe(true)

  expect(
    await popup.evaluate<boolean>(`!!document.querySelector('${byTestId(TID.snapshotsOpCard)}')`)
  ).toBe(false)
})
