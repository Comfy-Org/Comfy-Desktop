// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  installs: [] as Record<string, unknown>[],
  localBuilds: [] as { id: string; name: string }[],
  signedIn: false,
  subject: null as string | null,
  sessionWorkspace: { workspaceType: 'personal' } as Record<string, string>,
  onToken: () => {},
  fromPanel: true,
  openSavedWorkflow: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../apps/openInComfy', () => ({ openSavedWorkflow: mocks.openSavedWorkflow }))
vi.mock('../apps/localBuild', () => ({ usableLocalBuilds: async () => mocks.localBuilds }))
vi.mock('../host/registry', () => ({ isPanelSender: () => mocks.fromPanel }))
vi.mock('./i18n', () => ({ t: (key: string) => key }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    status: () => ({ signedIn: mocks.signedIn, ...mocks.sessionWorkspace }),
    currentSubject: () => mocks.subject,
    getAccessToken: async () => {
      mocks.onToken()
      return mocks.signedIn ? 'token' : null
    }
  })
}))
vi.mock('../installations', () => ({
  CLOUD_SOURCE_ID: 'cloud',
  list: async () => mocks.installs,
  get: async (id: string) => mocks.installs.find((inst) => inst.id === id) ?? null
}))

import {
  accountKey,
  epochMs,
  isSavedWorkflowPath,
  newestFirst,
  readCloudListing,
  RECENT_WORKFLOW_CHANNELS,
  registerRecentWorkflowHandlers,
  userDirOf
} from './recentWorkflows'
import type { RecentWorkflow } from '../../types/ipc'

const GRAPH = { nodes: [{ id: 1, type: 'SaveImage' }], links: [] }
const EVENT = { sender: {} }
const EMPTY_GRAPH = { nodes: [], links: [], groups: [{ title: 'Inputs', bounding: [0, 0, 1, 1] }] }
const CLOUD = { id: 'inst-cloud', name: 'Comfy Cloud', sourceId: 'cloud', status: 'installed' }
const TEAM_SESSION = { workspaceId: 'team-a', workspaceName: 'Team A', workspaceType: 'team' }

let root: string

function list(buildIds?: string[], workspaceId = 'personal'): Promise<RecentWorkflow[]> {
  return mocks.handlers.get(RECENT_WORKFLOW_CHANNELS.list)!(
    EVENT,
    buildIds,
    workspaceId
  ) as Promise<RecentWorkflow[]>
}

function open(
  installationId: string,
  savedPath: string,
  { workspaceId = 'personal', account = accountKey(mocks.subject) } = {}
) {
  return mocks.handlers.get(RECENT_WORKFLOW_CHANNELS.open)!(EVENT, {
    installationId,
    path: savedPath,
    workspaceId,
    account
  })
}

function signIn(subject = 'user-a'): void {
  mocks.signedIn = true
  mocks.subject = subject
}

function openedScope(): { workspaceId: string; isCurrent: () => boolean } {
  return mocks.openSavedWorkflow.mock.calls[0]![2] as {
    workspaceId: string
    isCurrent: () => boolean
  }
}

async function localBuild(
  id: string,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const installPath = path.join(root, id)
  const workflows = path.join(installPath, 'ComfyUI', 'user', 'default', 'workflows')
  await mkdir(workflows, { recursive: true })
  mocks.installs.push({
    id,
    name,
    sourceId: 'standalone',
    status: 'installed',
    installPath,
    ...extra
  })
  mocks.localBuilds.push({ id, name })
  return workflows
}

async function saved(dir: string, relative: string, minutesAgo: number, body = GRAPH) {
  const file = path.join(dir, ...relative.split('/'))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body))
  const when = new Date(Date.now() - minutesAgo * 60_000)
  await utimes(file, when, when)
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.installs = []
  mocks.localBuilds = []
  mocks.signedIn = false
  mocks.subject = null
  mocks.sessionWorkspace = { workspaceType: 'personal' }
  mocks.onToken = () => {}
  mocks.fromPanel = true
  mocks.openSavedWorkflow.mockResolvedValue({ opened: true })
  registerRecentWorkflowHandlers()
  root = await mkdtemp(path.join(tmpdir(), 'recent-workflows-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(root, { recursive: true, force: true })
})

describe('recent workflows on this computer', () => {
  it('lists every build’s saved workflows, newest first, subfolders included', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    const main = await localBuild('inst-main', 'Main')
    await saved(lab, 'portrait.json', 30)
    await saved(main, 'video/wan loop.json', 5)
    await saved(main, 'notes.txt', 1)
    await saved(main, '.hidden/secret.json', 1)

    const recents = await list()

    expect(recents.map((w) => [w.title, w.path, w.buildName, w.where])).toEqual([
      ['wan loop', 'video/wan loop.json', 'Main', 'local'],
      ['portrait', 'portrait.json', 'Lab', 'local']
    ])
  })

  it('keeps only the ten most recent', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    for (let i = 0; i < 12; i++) await saved(lab, `flow ${i}.json`, i)

    const recents = await list()

    expect(recents).toHaveLength(10)
    expect(recents[0]!.title).toBe('flow 0')
  })

  it('counts the ten only among the builds asked for', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    const other = await localBuild('inst-other', 'Other workspace')
    for (let i = 0; i < 12; i++) await saved(other, `newer ${i}.json`, i)
    await saved(lab, 'portrait.json', 60)

    const recents = await list(['inst-lab'])

    expect(recents.map((w) => w.title)).toEqual(['portrait'])
  })

  it('refuses a file reached through a link that leaves the workflows folder', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    const outside = path.join(root, 'private')
    await mkdir(outside)
    await writeFile(path.join(outside, 'secret.json'), JSON.stringify(GRAPH))
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(outside, path.join(lab, 'escape'), linkType)

    expect(await open('inst-lab', 'escape/secret.json')).toEqual({
      opened: false,
      error: 'apps.local.openUnreadable'
    })
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })

  it('opens the saved file itself in its own build, by its saved path and not as a renamed copy', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'video/wan loop.json', 5)

    expect(await open('inst-lab', 'video/wan loop.json')).toEqual({ opened: true })

    expect(mocks.openSavedWorkflow).toHaveBeenCalledExactlyOnceWith(
      { where: 'local', build: 'inst-lab' },
      'video/wan loop.json',
      expect.objectContaining({ workspaceId: 'personal', minComfyUIVersion: null })
    )
  })

  it('opens a workflow saved blank or with only groups', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'blank.json', 5, EMPTY_GRAPH as never)

    expect(await open('inst-lab', 'blank.json')).toEqual({ opened: true })
    expect(mocks.openSavedWorkflow).toHaveBeenCalledOnce()
  })

  it('lists and opens only the builds of the workspace Home shows', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    const team = await localBuild('inst-team', 'Team build', { workspaceId: 'team-a' })
    await saved(lab, 'portrait.json', 5)
    await saved(team, 'storyboard.json', 10)

    expect((await list(undefined, 'team-a')).map((w) => [w.title, w.workspaceId])).toEqual([
      ['storyboard', 'team-a']
    ])
    expect(await open('inst-lab', 'portrait.json', { workspaceId: 'team-a' })).toEqual({
      opened: false,
      error: 'apps.local.openUnknownBuild'
    })
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })

  it('finds the workflows of a build started with --base-directory', async () => {
    await localBuild('inst-lab', 'Lab', { launchArgs: '--base-directory project' })
    const workflows = path.join(root, 'inst-lab', 'project', 'user', 'default', 'workflows')
    await saved(workflows, 'portrait.json', 5)

    expect((await list()).map((w) => w.path)).toEqual(['portrait.json'])
    expect(await open('inst-lab', 'portrait.json')).toEqual({ opened: true })
  })

  it('refuses a row listed for another account', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'portrait.json', 5)
    const [row] = await list()
    signIn('user-b')

    expect(await open('inst-lab', 'portrait.json', { account: row!.account })).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })

  it('refuses a path that leaves the workflows folder', async () => {
    await localBuild('inst-lab', 'Lab')
    await writeFile(path.join(root, 'outside.json'), JSON.stringify(GRAPH))

    expect(await open('inst-lab', '../../../../outside.json')).toEqual({
      opened: false,
      error: 'apps.local.openNotTaken'
    })
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'answers at once when a saved workflow was replaced by a pipe',
    async () => {
      const lab = await localBuild('inst-lab', 'Lab')
      execFileSync('mkfifo', [path.join(lab, 'pipe.json')])

      expect(await open('inst-lab', 'pipe.json')).toEqual({
        opened: false,
        error: 'apps.local.openUnreadable'
      })
    },
    2_000
  )

  it('says a file that is not a workflow cannot open', async () => {
    const lab = await localBuild('inst-lab', 'Lab')
    await writeFile(path.join(lab, 'list.json'), JSON.stringify([1, 2]))

    expect(await open('inst-lab', 'list.json')).toEqual({
      opened: false,
      error: 'apps.local.openNotWorkflow'
    })
  })
})

describe('recent workflows on Comfy Cloud', () => {
  it('lists none while Cloud is signed in to another workspace than Home shows', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await list(undefined, 'team-a')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops the listing when Cloud moves to another workspace while it is read', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        mocks.sessionWorkspace = TEAM_SESSION
        return Response.json([{ path: 'personal.json', modified: Date.now() }])
      })
    )

    expect(await list()).toEqual([])
  })

  it('tags each Cloud row with the workspace and account it was listed for', async () => {
    signIn()
    mocks.sessionWorkspace = TEAM_SESSION
    mocks.installs.push(CLOUD)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([{ path: 'team.json', modified: Date.now() }]))
    )

    const [row] = await list(undefined, 'team-a')

    expect(row).toMatchObject({ workspaceId: 'team-a', account: accountKey('user-a') })
    expect(row!.account).not.toBe(accountKey('user-b'))
  })

  it('lists none while signed out, without asking Cloud', async () => {
    mocks.installs.push(CLOUD)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await list()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists the saved workflows Cloud returns, mixed with the local ones by date', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'portrait.json', 30)
    const fetchMock = vi.fn(async () =>
      Response.json([{ path: 'upscale.json', size: 10, modified: Date.now() - 60_000 }])
    )
    vi.stubGlobal('fetch', fetchMock)

    const recents = await list()

    expect(recents.map((w) => [w.title, w.where, w.buildName])).toEqual([
      ['upscale', 'cloud', 'Comfy Cloud'],
      ['portrait', 'local', 'Lab']
    ])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/userdata?dir=workflows&recurse=true&split=false&full_info=true')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' })
  })

  it('does not ask Cloud when the workspace has no Comfy Cloud build', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'portrait.json', 30)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect((await list(['inst-lab'])).map((w) => w.title)).toEqual(['portrait'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still lists the local ones when Cloud fails', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    const lab = await localBuild('inst-lab', 'Lab')
    await saved(lab, 'portrait.json', 30)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )

    expect((await list()).map((w) => w.title)).toEqual(['portrait'])
  })

  it('opens a Cloud workflow on Comfy Cloud by its saved path, scoped to the listed workspace', async () => {
    signIn()
    mocks.sessionWorkspace = TEAM_SESSION
    mocks.installs.push(CLOUD)
    const fetchMock = vi.fn(async (_url: string) => Response.json(GRAPH))
    vi.stubGlobal('fetch', fetchMock)

    expect(await open('inst-cloud', 'team/upscale.json', { workspaceId: 'team-a' })).toEqual({
      opened: true
    })

    expect(fetchMock.mock.calls[0]![0]).toContain('/api/userdata/workflows%2Fteam%2Fupscale.json')
    expect(mocks.openSavedWorkflow).toHaveBeenCalledExactlyOnceWith(
      { where: 'cloud' },
      'team/upscale.json',
      expect.objectContaining({ workspaceId: 'team-a' })
    )
    expect(openedScope().isCurrent()).toBe(true)
    mocks.sessionWorkspace = { workspaceType: 'personal' }
    expect(openedScope().isCurrent()).toBe(false)
  })

  it('refuses to open a Team row while Cloud is signed in to Personal, without reading it', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await open('inst-cloud', 'upscale.json', { workspaceId: 'team-a' })).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })

  it('refuses to open what was read once Cloud moved to another workspace meanwhile', async () => {
    signIn()
    mocks.installs.push(CLOUD)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        mocks.sessionWorkspace = TEAM_SESSION
        return Response.json(GRAPH)
      })
    )

    expect(await open('inst-cloud', 'upscale.json')).toEqual({
      opened: false,
      error: 'workflowLaunch.openFailed'
    })
    expect(mocks.openSavedWorkflow).not.toHaveBeenCalled()
  })
})

describe('reading saved workflows', () => {
  it('reads Cloud’s modified time in milliseconds or seconds', () => {
    expect(epochMs(1_795_000_000_000)).toBe(1_795_000_000_000)
    expect(epochMs(1_795_000_000)).toBe(1_795_000_000_000)
    expect(epochMs('soon')).toBeNull()
  })

  it('keeps only JSON paths that stay inside the folder', () => {
    expect(isSavedWorkflowPath('a/b.json')).toBe(true)
    expect(isSavedWorkflowPath('../b.json')).toBe(false)
    expect(isSavedWorkflowPath('a\\b.json')).toBe(false)
    expect(isSavedWorkflowPath('a/b.txt')).toBe(false)
    expect(
      readCloudListing([{ path: 'x.json', modified: 1 }, { path: '../y.json', modified: 1 }, 'z'])
    ).toEqual([{ path: 'x.json', modifiedAt: 1000 }])
  })

  it('finds the user folder a build was started with', () => {
    const base = { id: 'a', installPath: '/builds/a' }
    expect(userDirOf({ ...base, launchArgs: '--user-directory /data/me' } as never)).toBe(
      path.resolve('/builds/a', '/data/me')
    )
    expect(userDirOf({ ...base, adoptedBaseDir: '/old' } as never)).toBe(path.join('/old', 'user'))
    expect(userDirOf(base as never)).toBe(path.join('/builds/a', 'ComfyUI', 'user'))
  })

  it('takes --user-directory over --base-directory, and either over an adopted folder', () => {
    const base = { id: 'a', installPath: '/builds/a', adoptedBaseDir: '/old' }
    expect(userDirOf({ ...base, launchArgs: '--base-directory /data/project' } as never)).toBe(
      path.resolve('/data/project', 'user')
    )
    expect(userDirOf({ ...base, launchArgs: '--base-directory=relative' } as never)).toBe(
      path.resolve('/builds/a', 'relative', 'user')
    )
    expect(
      userDirOf({
        ...base,
        launchArgs: '--base-directory /data/project --user-directory /data/me'
      } as never)
    ).toBe(path.resolve('/data/me'))
  })

  it('puts the newest first', () => {
    const at = (modifiedAt: number) => ({ modifiedAt }) as RecentWorkflow
    expect(newestFirst([at(1), at(3), at(2)], 2).map((w) => w.modifiedAt)).toEqual([3, 2])
  })
})
