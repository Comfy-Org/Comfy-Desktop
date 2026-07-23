/**
 * TEMP(dist-mock) — installed workspace distributions inside the REAL
 * instance-picker popup, fed entirely by renderer-local mock data.
 *
 * Two pieces:
 *   - `mockDistributionRows()`: installed mock distributions as picker rows.
 *   - `installDistributionMockApiLayer()`: wraps the picker's `window.api`
 *     shim so calls for `dist:*` ids are answered locally; everything else
 *     passes through to main untouched.
 *
 * This is the seam the real integration replaces: James swaps the row feed
 * for main-tracked distribution installs and the api layer for real
 * pickerSettings handlers. The section content below is the current
 * proposal for which fields exist per tab and which are editable — the
 * whole point of the mock is reviewing those decisions in the real UI.
 */
import { MOCK_DISTRIBUTIONS } from '../../devplatform/mocks'
import type { Distribution } from '../../devplatform/types'
import type { DetailSection, Installation, SnapshotListData } from '../../types/ipc'

export const DIST_ID_PREFIX = 'dist:'

export function isMockDistributionId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(DIST_ID_PREFIX)
}

/** TEMP: the popup has no auth/workspace store — hardcoded to the mock
 *  workspace the chooser presents. */
const MOCK_WORKSPACE_NAME = 'Comfy Design Team'

function isInstalledState(dist: Distribution): boolean {
  return dist.state === 'installed' || dist.state === 'update-available'
}

function mockInstallPath(dist: Distribution): string {
  return `~/ComfyUI-Distributions/${dist.name}`
}

function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : ''
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Installed mock distributions as picker-list rows. The `dist:` id prefix
 *  is the discriminator every mock code path keys off. */
export function mockDistributionRows(): Installation[] {
  return MOCK_DISTRIBUTIONS.filter(isInstalledState).map((dist) => ({
    id: `${DIST_ID_PREFIX}${dist.id}`,
    name: dist.name,
    sourceLabel: MOCK_WORKSPACE_NAME,
    // Unknown category → Box icon in installTypeMetaFor, and pickerTabs
    // hides the Console tab for it.
    sourceCategory: 'distribution',
    version: dist.installedVersion ? `Dist v${dist.installedVersion}` : undefined,
    status: 'installed',
    installPath: mockInstallPath(dist),
    statusTag:
      dist.state === 'update-available'
        ? { style: 'update', label: `Dist v${dist.version} available` }
        : undefined
  }))
}

/**
 * The tabbed Manage content for one distribution row. Tab presence is
 * data-driven (a tab renders iff a section carries its tag), so this list IS
 * the tab set: Update, Startup Args (settings), Snapshots, Storage, About
 * (status). Console is category-hidden.
 */
function buildDistributionSections(dist: Distribution): DetailSection[] {
  const installedVersion = dist.installedVersion ?? dist.version ?? '?'
  const hasUpdate = dist.state === 'update-available'
  return [
    // --- Update: same channel-cards shape the standalone source emits, so
    //     ChannelPicker renders the identical headline + facts box. A single
    //     option = trackless mode: no track card, and the actions (Update
    //     Now / Check for Updates) render inside the versions table. ---
    {
      tab: 'update',
      title: 'Updates',
      fields: [
        {
          id: 'updateChannel',
          label: 'Updates',
          value: 'latest',
          editable: true,
          refreshSection: true,
          editType: 'channel-cards',
          options: [
            {
              value: 'latest',
              label: 'Latest published',
              data: {
                installedVersion: `Dist v${installedVersion}`,
                latestVersion: `Dist v${dist.version ?? installedVersion}`,
                bundledComfyVersion: dist.comfyuiVersion ? `v${dist.comfyuiVersion}` : undefined,
                lastChecked: 'Just now',
                lastCheckedAt: Date.now() - 60_000,
                updateAvailable: hasUpdate,
                actions: hasUpdate
                  ? [
                      {
                        id: 'dist-update-now',
                        label: 'Update Now',
                        style: 'primary',
                        enabled: true,
                        tooltip: `Update to Dist v${dist.version}`
                      }
                    ]
                  : []
              }
            }
          ]
        }
      ],
      actions: [{ id: 'check-update', label: 'Check for Updates' }]
    },
    {
      tab: 'update',
      title: 'Automatic Updates',
      fields: [
        {
          id: 'dist-auto-update',
          label: 'Update automatically on launch',
          value: false,
          editable: true,
          editType: 'boolean'
        }
      ]
    },
    // --- Startup Args: what the distribution locks vs what the user owns. ---
    {
      tab: 'settings',
      title: 'Launch',
      fields: [
        {
          id: 'dist-name',
          label: 'Name',
          value: dist.name,
          editable: false,
          tooltip: 'Distribution names are set by the workspace.'
        },
        {
          id: 'dist-extra-args',
          label: 'Additional Arguments',
          value: '',
          editable: true,
          editType: 'text',
          placeholder: '--example-flag',
          description: 'Appended after the arguments the distribution defines.'
        }
      ]
    },
    {
      tab: 'settings',
      title: 'Distribution Arguments',
      description: 'Defined by the distribution and locked on this computer.',
      fields: [
        {
          id: 'dist-locked-args',
          label: 'Arguments',
          value: '--fast --preview-method taesd',
          editable: false
        }
      ]
    },
    // --- Snapshots: tab shown, list empty — whether distributions keep
    //     snapshots at all is an open decision (dist versions may BE the
    //     rollback mechanism). ---
    { tab: 'snapshots', title: 'Snapshots' },
    // --- Storage ---
    {
      tab: 'storage',
      title: 'Storage',
      fields: [
        {
          id: 'dist-install-path',
          label: 'Install Location',
          value: mockInstallPath(dist),
          editable: false,
          editType: 'path'
        },
        {
          id: 'dist-size',
          label: 'Size on Disk',
          value: formatSize(dist.sizeBytes) || '—',
          editable: false
        }
      ]
    },
    // --- About ---
    {
      tab: 'status',
      title: 'About',
      fields: [
        { id: 'about-dist', label: 'Distribution', value: dist.name, editable: false },
        { id: 'about-workspace', label: 'Workspace', value: MOCK_WORKSPACE_NAME, editable: false },
        {
          id: 'about-installed',
          label: 'Installed Version',
          value: `Dist v${installedVersion}`,
          editable: false
        },
        {
          id: 'about-comfyui',
          label: 'ComfyUI Version',
          value: dist.comfyuiVersion ? `v${dist.comfyuiVersion}` : '—',
          editable: false
        },
        {
          id: 'about-published',
          label: 'Published',
          value: formatDate(dist.finishedAt) || '—',
          editable: false
        }
      ]
    }
  ]
}

function sectionsForMockId(mockRowId: string): DetailSection[] {
  const dist = MOCK_DISTRIBUTIONS.find((d) => `${DIST_ID_PREFIX}${d.id}` === mockRowId)
  return dist ? buildDistributionSections(dist) : []
}

function emptySnapshots(): SnapshotListData {
  return {
    snapshots: [],
    copyEvents: [],
    totalCount: 0,
    context: { updateChannel: 'stable', pythonVersion: '3.12', variant: '', variantLabel: '' }
  }
}

type AnyFn = (...args: unknown[]) => unknown

/**
 * Wrap the picker's `window.api` (installed by `installPickerSettingsApiShim`)
 * so calls carrying a `dist:*` id resolve from the mocks above. Must run
 * after the shim and before Vue mounts, for the same capture reason.
 */
export function installDistributionMockApiLayer(): void {
  const real = (window as unknown as { api?: Record<string, AnyFn> }).api
  if (!real) return

  /** Route a call by first-arg id: mock answer for dist rows, else real. */
  function byId(name: string, mock: (id: string, ...rest: unknown[]) => unknown): AnyFn {
    // Every wrapped name exists on the shim; the cast just narrows the
    // Record's `| undefined` index read.
    const original = real![name] as AnyFn
    return (...args: unknown[]) =>
      isMockDistributionId(args[0])
        ? Promise.resolve(mock(args[0] as string, ...args.slice(1)))
        : original(...args)
  }

  const wrapped: Record<string, AnyFn> = {
    ...real,
    getDetailSections: byId('getDetailSections', (id) => sectionsForMockId(id)),
    getInstallationSize: byId('getInstallationSize', (id) => {
      const dist = MOCK_DISTRIBUTIONS.find((d) => `${DIST_ID_PREFIX}${d.id}` === id)
      return { sizeBytes: dist?.sizeBytes ?? null }
    }),
    getSnapshots: byId('getSnapshots', () => emptySnapshots()),
    getComfyArgs: byId('getComfyArgs', () => []),
    getStableTags: byId('getStableTags', () => []),
    getFieldOptions: byId('getFieldOptions', () => []),
    // Writes + actions are accepted and dropped — the mock has no backend.
    updateInstallation: byId('updateInstallation', () => ({ ok: true })),
    runAction: byId('runAction', () => ({ ok: true }))
  }

  ;(window as unknown as { api: unknown }).api = wrapped
}
