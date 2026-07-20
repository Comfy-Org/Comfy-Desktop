import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-desktop-2-settings-'))
const homePath = path.join(tmpRoot, 'home')
const userDataPath = path.join(homePath, 'AppData', 'Roaming', 'comfyui-desktop-2')
const adminHomePath = path.join(tmpRoot, 'Administrator')
const adminUserDataPath = path.join(adminHomePath, 'AppData', 'Roaming', 'comfyui-desktop-2')
const xdgConfigHome = path.join(homePath, '.config')
const xdgCacheHome = path.join(homePath, '.cache')
const adminXdgCacheHome = path.join(adminHomePath, '.cache')
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME
const originalXdgCacheHome = process.env.XDG_CACHE_HOME

process.env.XDG_CONFIG_HOME = xdgConfigHome
process.env.XDG_CACHE_HOME = xdgCacheHome
fs.mkdirSync(homePath, { recursive: true })
// A home-root footprint marks this as an existing install, so on Windows the
// large-data defaults resolve to the home layout these tests assert (a clean
// machine would instead default to %LOCALAPPDATA%\Comfy-Desktop).
fs.mkdirSync(path.join(homePath, 'ComfyUI-Installs'), { recursive: true })
fs.mkdirSync(userDataPath, { recursive: true })
fs.mkdirSync(adminHomePath, { recursive: true })
fs.mkdirSync(adminUserDataPath, { recursive: true })
fs.mkdirSync(xdgConfigHome, { recursive: true })
fs.mkdirSync(xdgCacheHome, { recursive: true })

let settings: {
  set: (key: string, value: unknown) => void
  get: (key: string) => unknown
  has: (key: string) => boolean
  defaults: { onAppClose: 'tray' | 'quit' }
  getTrackedSettingsTelemetryProperties: (
    keys?: readonly string[]
  ) => Record<string, boolean | number | string | null>
}

const settingsPath = process.platform === 'linux'
  ? path.join(xdgConfigHome, 'comfyui-desktop-2', 'settings.json')
  : path.join(userDataPath, 'settings.json')
const expectedCacheDir = process.platform === 'linux'
  ? path.join(xdgCacheHome, 'comfyui-desktop-2', 'download-cache')
  : path.join(userDataPath, 'download-cache')
const copiedAdminCacheDir = process.platform === 'linux'
  ? path.join(adminXdgCacheHome, 'comfyui-desktop-2', 'download-cache')
  : path.join(adminUserDataPath, 'download-cache')
const shouldRewriteCopiedDefaults = process.platform === 'win32'

function readPersistedSettings(): Record<string, unknown> {
  const raw = fs.readFileSync(settingsPath, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

beforeEach(async () => {
  fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true })
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name === 'home') return homePath
        return userDataPath
      },
    },
  }))
  settings = await import('./settings')
})

afterAll(() => {
  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome
  if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalXdgCacheHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('settings unset/default semantics', () => {
  it('treats undefined as unset and falls back to default', () => {
    settings.set('onAppClose', 'quit')
    expect(settings.get('onAppClose')).toBe('quit')

    settings.set('onAppClose', undefined)

    expect(settings.get('onAppClose')).toBe(settings.defaults.onAppClose)
    const persisted = readPersistedSettings()
    expect(persisted).not.toHaveProperty('onAppClose')
  })

  it('persists and clears the nullable lastSaveDialogDir', () => {
    const dir = path.join(homePath, 'Pictures', 'renders')
    settings.set('lastSaveDialogDir', dir)
    expect(settings.get('lastSaveDialogDir')).toBe(dir)
    expect(readPersistedSettings()['lastSaveDialogDir']).toBe(dir)

    settings.set('lastSaveDialogDir', undefined)
    expect(settings.get('lastSaveDialogDir')).toBeUndefined()
    expect(readPersistedSettings()).not.toHaveProperty('lastSaveDialogDir')
  })

  it('normalizes legacy null values to unset on write', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ autoUpdate: null }, null, 2),
      'utf-8'
    )

    expect(settings.get('autoUpdate')).toBeUndefined()

    settings.set('theme', 'dark')

    const persisted = readPersistedSettings()
    expect(persisted).not.toHaveProperty('autoUpdate')
    expect(persisted['theme']).toBe('dark')
  })

  it('drops the legacy primaryInstallId and pinnedInstallIds keys on load', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          primaryInstallId: 'inst-1',
          pinnedInstallIds: ['inst-2', 'inst-3'],
          theme: 'dark',
        },
        null,
        2
      ),
      'utf-8'
    )

    expect(settings.get('primaryInstallId' as string)).toBeUndefined()
    expect(settings.get('pinnedInstallIds' as string)).toBeUndefined()
    expect(settings.get('theme')).toBe('dark')

    const persisted = readPersistedSettings()
    expect(persisted).not.toHaveProperty('primaryInstallId')
    expect(persisted).not.toHaveProperty('pinnedInstallIds')
    expect(persisted['theme']).toBe('dark')
  })

  it('discards the legacy maxCachedFiles key and defaults maxCachedDownloads to 1', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ maxCachedFiles: 5, theme: 'dark' }, null, 2),
      'utf-8'
    )

    expect(settings.get('maxCachedDownloads')).toBe(1)
    expect(settings.get('maxCachedFiles' as string)).toBeUndefined()
    expect(settings.get('theme')).toBe('dark')

    const persisted = readPersistedSettings()
    expect(persisted).not.toHaveProperty('maxCachedFiles')
    expect(persisted['maxCachedDownloads']).toBe(1)
  })

  it('preserves a manual maxCachedDownloads edit', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ maxCachedDownloads: 9 }, null, 2),
      'utf-8'
    )

    expect(settings.get('maxCachedDownloads')).toBe(9)
    expect(readPersistedSettings()['maxCachedDownloads']).toBe(9)
  })

  it('treats null for unknown keys as passthrough values', () => {
    settings.set('customKey' as string, null)
    expect(settings.get('customKey' as string)).toBeNull()
    expect(readPersistedSettings()['customKey']).toBeNull()
  })

  it('defaults installDir to ~/ComfyUI-Installs and persists overrides', () => {
    const builtinDefault = path.join(homePath, 'ComfyUI-Installs')
    expect(settings.get('installDir')).toBe(builtinDefault)

    const custom = path.join(homePath, 'Custom', 'Installs')
    settings.set('installDir', custom)
    expect(settings.get('installDir')).toBe(custom)
    expect(readPersistedSettings()['installDir']).toBe(custom)

    settings.set('installDir', undefined)
    expect(settings.get('installDir')).toBe(builtinDefault)
    expect(readPersistedSettings()).not.toHaveProperty('installDir')
  })

  // The volume check keys off the path root, which is always `/` on POSIX, so
  // this dead-drive fallback only meaningfully applies on Windows.
  it.runIf(process.platform === 'win32')(
    'falls back installDir/cacheDir to defaults when their volume is gone',
    () => {
      const builtinDefault = path.join(homePath, 'ComfyUI-Installs')
      const deadInstall = 'Z:\\Comfy-Desktop\\ComfyUI-Installs'
      const deadCache = 'Z:\\Comfy-Desktop\\ComfyUI-Cache\\download-cache'
      settings.set('installDir', deadInstall)
      settings.set('cacheDir', deadCache)

      const realExistsSync = fs.existsSync.bind(fs)
      const spy = vi
        .spyOn(fs, 'existsSync')
        .mockImplementation((p: fs.PathLike) =>
          p.toString().toUpperCase().startsWith('Z:\\') ? false : realExistsSync(p)
        )
      try {
        // Drive Z: is gone, so both fall back to the (home-layout) defaults...
        expect(settings.get('installDir')).toBe(builtinDefault)
        expect(settings.get('cacheDir')).toBe(expectedCacheDir)
        // ...and the fallback is persisted so it's deterministic next launch.
        const persisted = readPersistedSettings()
        expect(persisted['installDir']).toBe(builtinDefault)
        expect(persisted['cacheDir']).toBe(expectedCacheDir)
      } finally {
        spy.mockRestore()
      }
    }
  )

  it('keeps a custom installDir on a live volume even if it does not exist yet', () => {
    // Created-on-demand parent dirs must not be reset just because the leaf is
    // absent — only a missing volume triggers fallback.
    const custom = path.join(homePath, 'Not', 'Yet', 'Created', 'Installs')
    expect(fs.existsSync(custom)).toBe(false)
    settings.set('installDir', custom)
    expect(settings.get('installDir')).toBe(custom)
    expect(readPersistedSettings()['installDir']).toBe(custom)
  })

  it('autoLaunchOnStartup defaults to "none" when absent and persists explicit choices', () => {
    expect(settings.get('autoLaunchOnStartup')).toBe('none')

    settings.set('autoLaunchOnStartup', 'last')
    expect(settings.get('autoLaunchOnStartup')).toBe('last')
    expect(readPersistedSettings()['autoLaunchOnStartup']).toBe('last')

    settings.set('autoLaunchOnStartup', 'inst-12345')
    expect(settings.get('autoLaunchOnStartup')).toBe('inst-12345')
    expect(readPersistedSettings()['autoLaunchOnStartup']).toBe('inst-12345')

    settings.set('autoLaunchOnStartup', 'none')
    expect(settings.get('autoLaunchOnStartup')).toBe('none')
    expect(readPersistedSettings()).not.toHaveProperty('autoLaunchOnStartup')
  })

  it('treats empty and whitespace-only strings as unset for pypiMirror', () => {
    settings.set('pypiMirror', 'https://mirrors.aliyun.com/pypi/simple/')
    expect(settings.get('pypiMirror')).toBe('https://mirrors.aliyun.com/pypi/simple/')

    settings.set('pypiMirror', '')
    expect(settings.get('pypiMirror')).toBeUndefined()
    expect(readPersistedSettings()).not.toHaveProperty('pypiMirror')

    settings.set('pypiMirror', 'https://example.com/simple/')
    settings.set('pypiMirror', '   ')
    expect(settings.get('pypiMirror')).toBeUndefined()
    expect(readPersistedSettings()).not.toHaveProperty('pypiMirror')
  })
})

describe('settings path sanitization', () => {
  it('rewrites copied foreign-user defaults on Windows only', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    const customModelsDir = path.join(tmpRoot, 'custom-models')
    // The directories referenced below must exist on disk, otherwise the
    // "all model dirs missing -> restore shared default" and "input/output
    // missing -> fall back to default" safeguards would fire and obscure
    // what this test is actually checking (path sanitization).
    fs.mkdirSync(customModelsDir, { recursive: true })
    for (const sub of ['models', 'input', 'output']) {
      fs.mkdirSync(path.join(adminHomePath, 'ComfyUI-Shared', sub), { recursive: true })
    }
    // systemDefault is no longer force-appended when the user's
    // modelsDirs is non-empty. On Windows the foreign-admin path is
    // dropped via sanitizeModelsDirs and the user is left with just
    // their custom entry; on non-Windows the admin path stays because
    // sanitization doesn't run.
    const expectedModelsDirs = shouldRewriteCopiedDefaults
      ? [customModelsDir]
      : [
          path.join(adminHomePath, 'ComfyUI-Shared', 'models'),
          customModelsDir,
        ]
    const expectedInputDir = shouldRewriteCopiedDefaults
      ? path.join(homePath, 'ComfyUI-Shared', 'input')
      : path.join(adminHomePath, 'ComfyUI-Shared', 'input')
    const expectedOutputDir = shouldRewriteCopiedDefaults
      ? path.join(homePath, 'ComfyUI-Shared', 'output')
      : path.join(adminHomePath, 'ComfyUI-Shared', 'output')
    const expectedPersistedCacheDir = shouldRewriteCopiedDefaults
      ? expectedCacheDir
      : copiedAdminCacheDir
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        cacheDir: copiedAdminCacheDir,
        modelsDirs: [
          path.join(adminHomePath, 'ComfyUI-Shared', 'models'),
          customModelsDir,
        ],
        inputDir: path.join(adminHomePath, 'ComfyUI-Shared', 'input'),
        outputDir: path.join(adminHomePath, 'ComfyUI-Shared', 'output'),
      }, null, 2),
      'utf-8'
    )

    expect(settings.get('cacheDir')).toBe(expectedPersistedCacheDir)
    expect(settings.get('modelsDirs')).toEqual(expectedModelsDirs)
    expect(settings.get('inputDir')).toBe(expectedInputDir)
    expect(settings.get('outputDir')).toBe(expectedOutputDir)

    const persisted = readPersistedSettings()
    expect(persisted['cacheDir']).toBe(expectedPersistedCacheDir)
    expect(persisted['modelsDirs']).toEqual(expectedModelsDirs)
    expect(persisted['inputDir']).toBe(expectedInputDir)
    expect(persisted['outputDir']).toBe(expectedOutputDir)
  })
})

describe('settings.has (persisted-only check)', () => {
  it('returns false when settings.json does not exist yet', () => {
    expect(settings.has('theme')).toBe(false)
    // Built-in defaults must NOT register as user choices, even though they show up in getAll().
    expect(settings.has('inputDir')).toBe(false)
  })

  it('returns false for keys with defaults even after first load creates settings.json', () => {
    // Force a write so the file exists but doesn't carry the defaulted keys.
    settings.set('theme', 'dark')
    expect(fs.existsSync(settingsPath)).toBe(true)
    expect(settings.has('theme')).toBe(true)
    expect(settings.has('inputDir')).toBe(false)
    expect(settings.has('cacheDir')).toBe(false)
  })

  it('returns true once the user explicitly sets the key', () => {
    settings.set('theme', 'dark')
    expect(settings.has('theme')).toBe(true)
  })

  it('returns false after the key is unset', () => {
    settings.set('theme', 'dark')
    expect(settings.has('theme')).toBe(true)
    settings.set('theme', undefined)
    expect(settings.has('theme')).toBe(false)
  })

  it('returns false for null persisted values', () => {
    // legacy null normalization: any null on disk is treated as unset.
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: null }), 'utf-8')
    expect(settings.has('theme')).toBe(false)
  })

  it('treats a stale sentinel value as unset (autoLaunchOnStartup: none)', () => {
    // A manually edited / migrated file may still carry the 'none' sentinel that
    // set() would have dropped; has() must not report it as a user choice.
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify({ autoLaunchOnStartup: 'none' }), 'utf-8')
    expect(settings.has('autoLaunchOnStartup')).toBe(false)
  })

  it('treats a whitespace-only pypiMirror as unset', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify({ pypiMirror: '   ' }), 'utf-8')
    expect(settings.has('pypiMirror')).toBe(false)
  })
})

describe('modelsDirs user ordering', () => {
  it('preserves user-chosen primary models path across restarts', () => {
    const userPrimary = path.join(tmpRoot, 'D-drive-models')
    const systemDefault = path.join(homePath, 'ComfyUI-Shared', 'models')
    // Must exist on disk so the "all model dirs missing" safeguard
    // doesn't promote systemDefault ahead of the user's primary.
    fs.mkdirSync(userPrimary, { recursive: true })
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ modelsDirs: [userPrimary, systemDefault] }, null, 2),
      'utf-8'
    )

    expect(settings.get('modelsDirs')).toEqual([userPrimary, systemDefault])
    expect((settings.get('modelsDirs') as string[])[0]).toBe(userPrimary)
  })

  it('does not recreate ~/ComfyUI-Shared when user has custom existing paths (#699)', () => {
    // Alexis's scenario: custom model/input/output paths that all exist,
    // and a deleted ~/ComfyUI-Shared. None of it should reappear on load.
    //
    // beforeEach only wipes settings.json's parent dir; sweep the shared
    // root from any previous test in this run so we can assert it stays
    // absent after `settings.get` loads.
    const sharedRoot = path.join(homePath, 'ComfyUI-Shared')
    fs.rmSync(sharedRoot, { recursive: true, force: true })

    const userModels = path.join(tmpRoot, 'only-my-models')
    const userInput = path.join(tmpRoot, 'only-my-input')
    const userOutput = path.join(tmpRoot, 'only-my-output')
    for (const d of [userModels, userInput, userOutput]) fs.mkdirSync(d, { recursive: true })
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ modelsDirs: [userModels], inputDir: userInput, outputDir: userOutput }, null, 2),
      'utf-8'
    )

    expect(settings.get('modelsDirs')).toEqual([userModels])
    expect(settings.get('inputDir')).toBe(userInput)
    expect(settings.get('outputDir')).toBe(userOutput)

    // And ~/ComfyUI-Shared must NOT have been recreated on disk.
    expect(fs.existsSync(sharedRoot)).toBe(false)
  })

  it('restores shared default as primary when all model dirs are missing (#699)', () => {
    // The user's only model dir was deleted (e.g. by a system tool). The
    // app must never be left with no usable models dir, so the shared
    // default is restored as the primary entry and created on disk.
    const sharedRoot = path.join(homePath, 'ComfyUI-Shared')
    fs.rmSync(sharedRoot, { recursive: true, force: true })
    const systemDefault = path.join(homePath, 'ComfyUI-Shared', 'models')
    const missing = path.join(tmpRoot, 'gone-models') // deliberately not created

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ modelsDirs: [missing] }, null, 2),
      'utf-8'
    )

    const dirs = settings.get('modelsDirs') as string[]
    expect(dirs[0]).toBe(systemDefault) // restored as primary (non-deletable)
    expect(dirs.length).toBe(2) // the missing custom path is kept after it
    expect(fs.existsSync(systemDefault)).toBe(true) // created on disk
  })

  it('falls back to the default input/output dir when the designated one is missing (#699)', () => {
    const sharedRoot = path.join(homePath, 'ComfyUI-Shared')
    const defaultInput = path.join(sharedRoot, 'input')
    const defaultOutput = path.join(sharedRoot, 'output')
    const missingInput = path.join(tmpRoot, 'gone-input') // not created
    const missingOutput = path.join(tmpRoot, 'gone-output') // not created

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ inputDir: missingInput, outputDir: missingOutput }, null, 2),
      'utf-8'
    )

    expect(settings.get('inputDir')).toBe(defaultInput)
    expect(settings.get('outputDir')).toBe(defaultOutput)
    expect(fs.existsSync(defaultInput)).toBe(true)
    expect(fs.existsSync(defaultOutput)).toBe(true)
  })

  it('preserves an existing custom input/output dir', () => {
    const customInput = path.join(tmpRoot, 'my-input')
    const customOutput = path.join(tmpRoot, 'my-output')
    fs.mkdirSync(customInput, { recursive: true })
    fs.mkdirSync(customOutput, { recursive: true })
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ inputDir: customInput, outputDir: customOutput }, null, 2),
      'utf-8'
    )

    expect(settings.get('inputDir')).toBe(customInput)
    expect(settings.get('outputDir')).toBe(customOutput)
  })

  it('injects system default when modelsDirs is empty', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ modelsDirs: [] }, null, 2),
      'utf-8'
    )

    const dirs = settings.get('modelsDirs') as string[]
    expect(dirs.length).toBe(1)
    expect(path.resolve(dirs[0]!)).toBe(path.join(homePath, 'ComfyUI-Shared', 'models'))
  })
})

describe('getTrackedSettingsTelemetryProperties (telemetry policy)', () => {
  const realPlatform = process.platform

  function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    try {
      return fn()
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    }
  }

  it('autoInstallUpdates: effective value plus an explicit-set companion', () => {
    // Unset => default-on and not explicit.
    expect(settings.getTrackedSettingsTelemetryProperties(['autoInstallUpdates'])).toEqual({
      auto_install_updates: true,
      auto_install_updates_explicit: false,
    })
    // Explicit false => off and explicit.
    settings.set('autoInstallUpdates', false)
    expect(settings.getTrackedSettingsTelemetryProperties(['autoInstallUpdates'])).toEqual({
      auto_install_updates: false,
      auto_install_updates_explicit: true,
    })
    // Explicit true => on and explicit (distinct from the default-on majority).
    settings.set('autoInstallUpdates', true)
    expect(settings.getTrackedSettingsTelemetryProperties(['autoInstallUpdates'])).toEqual({
      auto_install_updates: true,
      auto_install_updates_explicit: true,
    })
  })

  it('language: emits only the selected value (null when following the OS default)', () => {
    // Effective locale lives on the app.language_resolved event, not here.
    expect(settings.getTrackedSettingsTelemetryProperties(['language'])).toEqual({
      setting_language_selected: null,
    })
    settings.set('language', 'zh')
    expect(settings.getTrackedSettingsTelemetryProperties(['language'])).toEqual({
      setting_language_selected: 'zh',
    })
  })

  it('omits the legacy autoUpdate setting entirely', () => {
    settings.set('autoUpdate', false)
    expect(settings.getTrackedSettingsTelemetryProperties()).not.toHaveProperty('setting_auto_update')
  })

  it('scalar value settings emit their typed value, never a hand-edited string', () => {
    // onAppClose enum + maxCachedDownloads number pass through when valid
    // (onAppClose resolves to its 'quit' default while tray docking is disabled).
    settings.set('maxCachedDownloads', 5)
    expect(
      settings.getTrackedSettingsTelemetryProperties(['onAppClose', 'maxCachedDownloads'])
    ).toEqual({
      setting_on_app_close: 'quit',
      setting_max_cached_downloads: 5,
    })
    // A corrupt/hand-edited settings.json can't leak a free-form string.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ onAppClose: '/Users/me/secret', maxCachedDownloads: 'lots' }),
      'utf-8'
    )
    expect(
      settings.getTrackedSettingsTelemetryProperties(['onAppClose', 'maxCachedDownloads'])
    ).toEqual({
      setting_on_app_close: null,
      setting_max_cached_downloads: null,
    })
  })

  it('omits the dark-only theme setting entirely', () => {
    settings.set('theme', 'light')
    const props = settings.getTrackedSettingsTelemetryProperties()
    expect(props).not.toHaveProperty('setting_theme')
    expect(props).not.toHaveProperty('setting_theme_selected')
  })

  it('default-off useChineseMirrors: unset reports false, explicit true reports true', () => {
    expect(settings.getTrackedSettingsTelemetryProperties(['useChineseMirrors'])).toEqual({
      setting_use_chinese_mirrors: false,
    })
    settings.set('useChineseMirrors', true)
    expect(settings.getTrackedSettingsTelemetryProperties(['useChineseMirrors'])).toEqual({
      setting_use_chinese_mirrors: true,
    })
  })

  it('Windows-only installUpdatesOnStartup: default-on true on win32, false when opted out', () => {
    withPlatform('win32', () => {
      expect(settings.getTrackedSettingsTelemetryProperties(['installUpdatesOnStartup'])).toEqual({
        install_updates_on_startup: true,
      })
    })
    settings.set('installUpdatesOnStartup', false)
    withPlatform('win32', () => {
      expect(settings.getTrackedSettingsTelemetryProperties(['installUpdatesOnStartup'])).toEqual({
        install_updates_on_startup: false,
      })
    })
  })

  it('Windows-only gates report null off-Windows (not applicable, not opted out)', () => {
    withPlatform('darwin', () => {
      expect(
        settings.getTrackedSettingsTelemetryProperties([
          'installUpdatesOnStartup',
          'showInstallerUI',
        ])
      ).toEqual({
        install_updates_on_startup: null,
        setting_show_installer_ui: null,
      })
    })
  })

  it('path settings emit presence booleans, never the raw path', () => {
    const before = settings.getTrackedSettingsTelemetryProperties([
      'installDir',
      'modelsDirs',
      'cacheDir',
    ])
    expect(before).toEqual({
      setting_install_dir: false,
      setting_models_dirs: false,
      setting_cache_dir: false,
    })
    settings.set('installDir', path.join(homePath, 'Custom', 'Installs'))
    const after = settings.getTrackedSettingsTelemetryProperties(['installDir'])
    expect(after.setting_install_dir).toBe(true)
    expect(Object.values(after).every((v) => typeof v !== 'string')).toBe(true)
  })

  it('autoLaunchOnStartup emits presence (bool-ified), never the install id', () => {
    expect(settings.getTrackedSettingsTelemetryProperties(['autoLaunchOnStartup'])).toEqual({
      setting_auto_launch_on_startup: false,
    })
    settings.set('autoLaunchOnStartup', 'some-install-id')
    expect(settings.getTrackedSettingsTelemetryProperties(['autoLaunchOnStartup'])).toEqual({
      setting_auto_launch_on_startup: true,
    })
  })

  it('omits internal bookkeeping and consent keys', () => {
    settings.set('firstUseCompleted', true)
    settings.set('telemetryEnabled', true)
    settings.set('chineseMirrorsPrompted', true)
    const props = settings.getTrackedSettingsTelemetryProperties()
    expect(props).not.toHaveProperty('setting_first_use_completed')
    expect(props).not.toHaveProperty('setting_telemetry_enabled')
    expect(props).not.toHaveProperty('setting_chinese_mirrors_prompted')
  })

  it('full snapshot includes both #1220 exact names and never emits arrays/objects', () => {
    const props = withPlatform('win32', () =>
      settings.getTrackedSettingsTelemetryProperties()
    )
    expect(props).toHaveProperty('auto_install_updates')
    expect(props).toHaveProperty('install_updates_on_startup')
    for (const value of Object.values(props)) {
      expect(['boolean', 'number', 'string']).toContain(
        value === null ? 'boolean' : typeof value
      )
    }
  })
})
