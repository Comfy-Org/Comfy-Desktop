import {
  ipcMain,
  dialog,
  shell,
  BrowserWindow,
  app,
  fs,
  path,
  os,
  sources,
  installations,
  settings,
  defaultInstallDir,
  getDiskSpace,
  getDirectorySize,
  validateInstallPath,
  detectGPUCached,
  validateHardware,
  checkNvidiaDriver,
  checkAmdDriver,
  selectPrimaryGpu,
  vendorMatches,
  getWindowsGpuDriverVersions,
  sourceMap,
  getAppVersion,
  openPath,
  listSnapshots,
  diffSnapshots,
  buildInstallationDdContext,
  _operationAborts,
  _runningSessions
} from './shared'
import si from 'systeminformation'
import type { RunPerformanceTestWorkflowResult, SystemInfo } from '../../../types/ipc'
import type { FieldOption } from './shared'
import * as mainTelemetry from '../telemetry'
import { getDeviceId } from '../deviceId'
import { getCachedWorkspaceName } from '../../cloud/tokenStore'
import { getCloudSession } from '../../devplatform/session'
import { getCloudFreeRunsEnabledAsync } from '../cloudFreeRuns'
import { getUserTierAsync } from '../userTier'
import { getStableTags } from '../comfyui-releases'
import { deriveGpuTier } from '../../../shared/gpuTier'
import { PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'
import {
  calculatePerformanceTestStatistics,
  deletePerformanceTestBenchmark,
  deletePerformanceTestWorkflow,
  listPerformanceTestBenchmarks,
  renamePerformanceTestBenchmark,
  readPerformanceTestResultsSummary,
  savePerformanceTestJobsResponse,
  savePerformanceTestLogs,
  savePerformanceTestResultsSummary,
  storePerformanceTestWorkflow,
  submitPerformanceTestWorkflow,
  waitForPerformanceTestJobs
} from '../performanceTestWorkflows'

export function registerAppHandlers(): void {
  // App version
  ipcMain.handle('get-app-version', () => getAppVersion())

  // Every stable ComfyUI release tag, newest first. Used by the
  // install-wizard and the per-install ChannelPicker version dropdown.
  // Returns `[]` (never throws) when the remote is unreachable.
  ipcMain.handle('get-stable-tags', () => getStableTags())

  // Signed-in user's Comfy Cloud subscription tier ('free' | 'paid' |
  // 'unknown'). Hydrated from a persisted file at boot and refreshed on
  // every cloud webContents `dom-ready`; consumed by billing telemetry and
  // free-tier offer UI. See `userTier.ts`.
  ipcMain.handle('get-cloud-user-tier', () => getUserTierAsync())

  // Whether the free tier is live, for the first-use trial pill. Bypasses
  // the consent gate so it resolves pre-consent, the only state that
  // surface renders in; fails CLOSED. See `cloudFreeRuns.ts`.
  ipcMain.handle('get-cloud-free-runs-enabled', () => getCloudFreeRunsEnabledAsync())

  // Sources
  ipcMain.handle('get-sources', () =>
    sources
      .filter((s) => s.category !== 'cloud' && !s.hidden)
      .filter((s) => !s.platforms || s.platforms.includes(process.platform))
      .map((s) => ({
        id: s.id,
        label: s.label,
        category: s.category,
        description: s.description,
        fields: s.fields,
        skipInstall: !!s.skipInstall,
        hideInstallPath: !!s.skipInstall
      }))
  )

  ipcMain.handle(
    'get-field-options',
    async (
      _event,
      sourceId: string,
      fieldId: string,
      selections: Record<string, unknown>,
      extraContext?: Record<string, unknown>
    ) => {
      const source = sourceMap[sourceId]
      if (!source) return []
      const gpu = await detectGPUCached()
      if (!source.getFieldOptions) return []
      const options = await source.getFieldOptions(
        fieldId,
        selections as Record<string, FieldOption | undefined>,
        { gpu: gpu && gpu.id, ...extraContext }
      )
      return options
    }
  )

  ipcMain.handle('detect-gpu', async () => detectGPUCached())

  ipcMain.handle('validate-hardware', async () => {
    const result = await validateHardware()
    // Emit a single event whether hardware passes or fails so we can build
    // funnels like "% of users who hit hardware-not-supported during install".
    mainTelemetry.emit('comfy.desktop.install.validation', {
      passed: result.supported,
      platform: process.platform,
      arch: process.arch,
      reason: result.supported ? null : (result.error ?? 'unsupported')
    })
    return result
  })
  ipcMain.handle('check-nvidia-driver', () => checkNvidiaDriver())

  ipcMain.handle(
    'build-installation',
    (_event, sourceId: string, selections: Record<string, unknown>) => {
      const source = sourceMap[sourceId]
      if (!source) return null
      return {
        sourceId: source.id,
        sourceLabel: source.label,
        ...source.buildInstallation(selections as Record<string, FieldOption | undefined>)
      }
    }
  )

  // Paths
  ipcMain.handle('get-default-install-dir', () => defaultInstallDir())

  ipcMain.handle('browse-folder', async (_event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender)
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      defaultPath: defaultPath || defaultInstallDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  ipcMain.handle('import-performance-test-workflow', async (_event, droppedFilePath?: string) => {
    let sourcePath = typeof droppedFilePath === 'string' ? droppedFilePath : ''
    if (!sourcePath) {
      const win = BrowserWindow.fromWebContents(_event.sender)
      if (!win) return { ok: false, message: 'No window.' }
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (canceled || filePaths.length === 0) return { ok: false, canceled: true }
      sourcePath = filePaths[0]!
    }
    try {
      const filePath = await storePerformanceTestWorkflow(sourcePath, app.getPath('userData'))
      return { ok: true, filePath }
    } catch (error) {
      return { ok: false, message: (error as Error)?.message || String(error) }
    }
  })

  ipcMain.handle('delete-performance-test-workflow', async (_event, filePath: string) => {
    try {
      const status = await deletePerformanceTestWorkflow(filePath, app.getPath('userData'))
      return {
        ok: true,
        status,
        message:
          status === 'preserved'
            ? 'This workflow belongs to a completed test and was kept with its results.'
            : undefined
      }
    } catch (error) {
      return { ok: false, message: (error as Error)?.message || String(error) }
    }
  })

  ipcMain.handle('save-performance-test-logs', async (_event, filePath: string, logs: string) => {
    try {
      if (typeof logs !== 'string') throw new Error('Invalid performance test logs.')
      const logsPath = await savePerformanceTestLogs(logs, filePath, app.getPath('userData'))
      return { ok: true, logsPath }
    } catch (error) {
      return { ok: false, message: (error as Error)?.message || String(error) }
    }
  })

  ipcMain.handle(
    'list-performance-test-benchmarks',
    async (_event, selectedFolderPath?: string) => {
      const folderPath =
        selectedFolderPath || path.join(app.getPath('userData'), 'performance-tests')
      return {
        folderPath,
        benchmarks: await listPerformanceTestBenchmarks(folderPath)
      }
    }
  )

  ipcMain.handle(
    'delete-performance-test-benchmark',
    async (_event, folderPath: string, sessionId: string) => {
      try {
        if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) {
          throw new Error('Invalid performance test folder.')
        }
        await deletePerformanceTestBenchmark(folderPath, sessionId)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: (error as Error)?.message || String(error) }
      }
    }
  )

  ipcMain.handle(
    'rename-performance-test-benchmark',
    async (_event, folderPath: string, sessionId: string, newSessionId: string) => {
      try {
        if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) {
          throw new Error('Invalid performance test folder.')
        }
        if (typeof sessionId !== 'string' || typeof newSessionId !== 'string') {
          throw new Error('Invalid performance test benchmark ID.')
        }
        await renamePerformanceTestBenchmark(folderPath, sessionId, newSessionId)
        return { ok: true, sessionId: newSessionId }
      } catch (error) {
        return { ok: false, message: (error as Error)?.message || String(error) }
      }
    }
  )

  ipcMain.handle('read-performance-test-results-summary', (_event, filePath: string) =>
    readPerformanceTestResultsSummary(filePath, app.getPath('userData'))
  )

  ipcMain.handle(
    'export-results-image',
    async (
      _event,
      png: ArrayBuffer,
      imageType: 'performance-test' | 'benchmark-comparison',
      defaultPath?: string
    ) => {
      const contents = png instanceof ArrayBuffer ? Buffer.from(png) : Buffer.alloc(0)
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      if (
        contents.length === 0 ||
        contents.length > 50_000_000 ||
        !contents.subarray(0, pngSignature.length).equals(pngSignature)
      ) {
        return { ok: false, message: 'Invalid results image.' }
      }
      const exportConfig =
        imageType === 'benchmark-comparison'
          ? { title: 'Export benchmark comparison', prefix: 'benchmark-comparison' }
          : imageType === 'performance-test'
            ? { title: 'Export performance test results', prefix: 'performance-test-results' }
            : null
      if (!exportConfig) return { ok: false, message: 'Invalid results image type.' }
      const win = BrowserWindow.fromWebContents(_event.sender)
      if (!win) return { ok: false, message: 'No window.' }
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: exportConfig.title,
        buttonLabel: 'Export here',
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      if (canceled || filePaths.length === 0) return { ok: false, canceled: true }

      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
        const filePath = path.join(filePaths[0]!, `${exportConfig.prefix}-${timestamp}.png`)
        await fs.promises.writeFile(filePath, contents)
        return { ok: true, filePath }
      } catch (error) {
        return { ok: false, message: (error as Error)?.message || String(error) }
      }
    }
  )

  ipcMain.handle(
    'run-performance-test-workflow',
    async (
      _event,
      sessionId: string,
      filePath: string,
      measuredRuns: number,
      warmupRuns: number
    ): Promise<RunPerformanceTestWorkflowResult> => {
      const acceptedPromptIds: string[] = []
      const abort = new AbortController()
      let ownsAbortSlot = false
      try {
        if (typeof sessionId !== 'string' || !sessionId.startsWith('performance-test:')) {
          throw new Error('Invalid performance test session.')
        }
        if (_operationAborts.has(sessionId)) {
          throw new Error('A performance test is already running for this instance.')
        }
        _operationAborts.set(sessionId, abort)
        ownsAbortSlot = true
        const session = _runningSessions.get(sessionId)
        if (!session) throw new Error('The performance test instance is not running.')
        const sourceInstallationId =
          session.sourceInstallationId ?? sessionId.slice('performance-test:'.length)
        const sourceInstallation = await installations.get(sourceInstallationId)
        const workspaceId = sourceInstallation?.workspaceId ?? null
        let workspaceName =
          workspaceId === PERSONAL_WORKSPACE_ID
            ? 'Personal'
            : workspaceId
              ? getCachedWorkspaceName(workspaceId)
              : null
        if (workspaceId) {
          try {
            const owningWorkspace = (await getCloudSession().listWorkspaces()).find(
              (workspace) => workspace.id === workspaceId
            )
            workspaceName = owningWorkspace?.name ?? workspaceName
          } catch {
            // The id-keyed cache remains accurate when workspace refresh is unavailable.
          }
        }
        const workspace = { id: workspaceId, name: workspaceName }
        const sessionUrl = session.url || `http://127.0.0.1:${session.port}`
        await submitPerformanceTestWorkflow(
          filePath,
          app.getPath('userData'),
          sessionUrl,
          measuredRuns,
          warmupRuns,
          fetch,
          abort.signal,
          (promptId) => acceptedPromptIds.push(promptId)
        )
        const preparationRuns = warmupRuns
        const measuredPromptIds = acceptedPromptIds.slice(warmupRuns)
        const jobsResponse = await waitForPerformanceTestJobs(
          sessionUrl,
          acceptedPromptIds,
          fetch,
          undefined,
          (completedRuns, totalRuns) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send('performance-test-progress', {
                sessionId,
                completedRuns,
                totalRuns
              })
            }
          },
          abort.signal
        )
        const submittedPromptIds = new Set(measuredPromptIds)
        const successfulRuns = jobsResponse.jobs.filter(
          (job) => submittedPromptIds.has(job.id) && job.status === 'completed'
        ).length
        const failedRuns = jobsResponse.jobs.filter(
          (job) => submittedPromptIds.has(job.id) && job.status !== 'completed'
        ).length
        const statistics = calculatePerformanceTestStatistics(jobsResponse, measuredPromptIds)
        const resultPath = await savePerformanceTestJobsResponse(
          jobsResponse,
          filePath,
          app.getPath('userData')
        )
        const hardware = session.getAcceleratorInfo?.() ?? null
        const systemInfo = await getSystemInfo()
        const resultsSummaryPath = await savePerformanceTestResultsSummary(
          statistics,
          {
            id: sourceInstallationId,
            name: session.installationName
          },
          workspace,
          hardware,
          systemInfo,
          filePath,
          app.getPath('userData'),
          successfulRuns,
          failedRuns
        )
        const resultsSummary = await readPerformanceTestResultsSummary(
          resultsSummaryPath,
          app.getPath('userData')
        )
        return {
          ok: true,
          submitted: measuredRuns,
          preparationRuns,
          totalSubmitted: measuredRuns + preparationRuns,
          promptIds: acceptedPromptIds,
          resultPath,
          resultsSummaryPath,
          statistics,
          hardware,
          systemInfo,
          resultsSummary,
          failedRuns
        }
      } catch (error) {
        const preparationRuns = Math.min(warmupRuns, acceptedPromptIds.length)
        const submitted = Math.max(0, acceptedPromptIds.length - preparationRuns)
        const detail = (error as Error)?.message || String(error)
        return {
          ok: false,
          submitted,
          preparationRuns,
          totalSubmitted: acceptedPromptIds.length,
          promptIds: acceptedPromptIds.length > 0 ? acceptedPromptIds : undefined,
          cancelled: abort.signal.aborted,
          message:
            acceptedPromptIds.length > 0
              ? `${detail} ${acceptedPromptIds.length} run(s) had already been accepted and were not retried.`
              : detail
        }
      } finally {
        if (ownsAbortSlot && _operationAborts.get(sessionId) === abort) {
          _operationAborts.delete(sessionId)
        }
      }
    }
  )

  ipcMain.handle('open-path', (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || !targetPath) return ''
    if (/^https?:\/\//i.test(targetPath)) return shell.openExternal(targetPath)
    const resolved = path.resolve(targetPath)
    if (!fs.existsSync(resolved)) return ''
    return openPath(resolved)
  })
  ipcMain.handle('open-external', (_event, url: string) => {
    if (typeof url !== 'string' || !url) return Promise.resolve()
    if (!/^https?:\/\//i.test(url)) return Promise.resolve()
    return shell.openExternal(url)
  })
  ipcMain.handle('get-disk-space', (_event, targetPath: string) => getDiskSpace(targetPath))
  ipcMain.handle('validate-install-path', (_event, targetPath: string) =>
    validateInstallPath(targetPath)
  )
  let activeSizeAc: AbortController | null = null
  let activeSizeInstId: string | null = null
  ipcMain.handle('get-installation-size', async (_event, installationId: string) => {
    if (activeSizeInstId !== installationId) activeSizeAc?.abort()
    const ac = new AbortController()
    activeSizeAc = ac
    activeSizeInstId = installationId
    try {
      const inst = await installations.get(installationId)
      if (!inst?.installPath) return { sizeBytes: 0 }
      const sizeBytes = await getDirectorySize(inst.installPath, ac.signal)
      return { sizeBytes }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return { sizeBytes: 0 }
      throw err
    } finally {
      if (activeSizeAc === ac) {
        activeSizeAc = null
        activeSizeInstId = null
      }
    }
  })
  ipcMain.handle('cancel-installation-size', () => {
    activeSizeAc?.abort()
    activeSizeAc = null
    activeSizeInstId = null
  })

  // Hardware probing spawns nvidia-smi plus several WMI/PowerShell queries
  // (systeminformation), and on Windows every process launch blocks the main
  // thread in CreateProcess. The hardware cannot change mid-session, so the
  // probe runs once and the promise is shared - the renderer bootstrap and
  // the first-use surface both request system info at boot. A failed probe
  // clears the cache so the next call retries.
  let hardwareProbe: Promise<Record<string, unknown>> | null = null
  const probeHardwareCached = (): Promise<Record<string, unknown>> => {
    hardwareProbe ??= probeHardware().catch((err) => {
      hardwareProbe = null
      throw err
    })
    return hardwareProbe
  }

  async function getSystemInfo(): Promise<SystemInfo> {
    const hardware = await probeHardwareCached()
    const cpus = os.cpus()
    const allInstalls = await installations.list()
    return {
      ...hardware,
      platform: process.platform,
      arch: process.arch,
      os_version: os.release(),
      electron_version: process.versions.electron,
      chrome_version: process.versions.chrome,
      total_memory_gb: Math.round(os.totalmem() / 1073741824),
      cpu_model: cpus[0]?.model ?? 'unknown',
      cpu_cores: cpus.length,
      app_version: getAppVersion(),
      // Issue #488 - repurposed to reflect the new `autoInstallUpdates`
      // toggle (silent install vs prompt). The auto-check loop is no
      // longer user-disablable, so this property captures what the
      // remaining toggle actually controls.
      auto_update: settings.get('autoInstallUpdates') !== false,
      locale: settings.get('language') || 'en',
      installation_count: allInstalls.length,
      installations: allInstalls.map((inst) => ({
        source_id: (inst.sourceId as string) || '',
        variant: (inst.variant as string) || '',
        update_channel: (inst.updateChannel as string) || 'stable',
        status: (inst.status as string) || 'ready'
      }))
    } as SystemInfo
  }

  ipcMain.handle('get-system-info', getSystemInfo)

  async function probeHardware(): Promise<Record<string, unknown>> {
    const gpu = await detectGPUCached()
    const nvidiaCheck = gpu?.id === 'nvidia' ? await checkNvidiaDriver() : null
    const amdDriverVersion = gpu?.id === 'amd' ? await checkAmdDriver() : undefined

    let osDistro: string | null = null
    let osRelease: string | null = null
    let osArch: string | null = null
    let cpuManufacturer: string | null = null
    let cpuPhysicalCores: number | null = null
    let cpuSpeedGhz: number | null = null
    let allGpus: Array<{
      vendor: string
      model: string
      vram_mb: number | null
      driver_version: string | null
    }> = []
    const [osResult, cpuResult, gpuResult] = await Promise.allSettled([
      si.osInfo(),
      si.cpu(),
      si.graphics()
    ])
    if (osResult.status === 'fulfilled') {
      osDistro = osResult.value.distro || null
      osRelease = osResult.value.release || null
      osArch = osResult.value.arch || null
    }
    if (cpuResult.status === 'fulfilled') {
      cpuManufacturer = cpuResult.value.manufacturer || null
      cpuPhysicalCores = cpuResult.value.physicalCores ?? null
      cpuSpeedGhz = cpuResult.value.speed ?? null
    }
    if (gpuResult.status === 'fulfilled') {
      allGpus = gpuResult.value.controllers.map((ctrl) => ({
        vendor: ctrl.vendor || '',
        model: ctrl.model || '',
        vram_mb: ctrl.vram ?? null,
        driver_version: ctrl.driverVersion?.trim() || null
      }))
      // systeminformation only fills `driverVersion` for NVIDIA on Windows
      // (via nvidia-smi), leaving AMD/Intel blank even though WMI carries it.
      // Backfill the missing versions from Win32_VideoController by name.
      const wmiDrivers = await getWindowsGpuDriverVersions()
      if (wmiDrivers.size > 0) {
        allGpus = allGpus.map((g) =>
          g.driver_version
            ? g
            : { ...g, driver_version: wmiDrivers.get(g.model.toLowerCase()) ?? null }
        )
      }
    }

    // `detectGPU()` only resolves the vendor (NVIDIA / AMD / Intel /
    // Apple Silicon) — its `model` field is hardcoded null. Pick the real
    // compute GPU from the systeminformation `controllers[]` instead of
    // blindly trusting `controllers[0]`: virtual display adapters are not
    // promoted. The full `allGpus` array is still returned unfiltered for
    // retroactive analysis. Empty strings from the lib normalise to null so
    // cohort filters on "is set" work consistently.
    const primaryGpu = selectPrimaryGpu(allGpus, gpu?.id ?? null)
    const primaryGpuModel = (primaryGpu?.model || null) ?? gpu?.model ?? null
    const primaryGpuVramMb = primaryGpu?.vram_mb ?? null
    const primaryGpuVramGb = primaryGpuVramMb != null ? Math.round(primaryGpuVramMb / 1024) : null
    const gpuTier = deriveGpuTier({ vendor: gpu?.id, vramGb: primaryGpuVramGb })
    // Only trust the primary controller's driver string when it actually
    // matches the detected compute vendor; selectPrimaryGpu may fall back to a
    // non-matching controller, which would otherwise mislabel the driver.
    const primaryGpuMatchesAmd = vendorMatches('amd', primaryGpu?.vendor, primaryGpu?.model)
    const primaryGpuMatchesIntel = vendorMatches('intel', primaryGpu?.vendor, primaryGpu?.model)
    // AMD: prefer the ROCm-reported version (compute-relevant); on Windows
    // there is no rocm-smi, so fall back to the controller's WMI driver.
    const amdDriver =
      gpu?.id === 'amd'
        ? (amdDriverVersion ?? (primaryGpuMatchesAmd ? primaryGpu?.driver_version : null) ?? null)
        : null
    // Intel has no dedicated CLI; the controller driver (WMI on Windows,
    // si on Linux) is the best available signal.
    const intelDriver =
      gpu?.id === 'intel' && primaryGpuMatchesIntel ? (primaryGpu?.driver_version ?? null) : null
    return {
      gpu_vendor: gpu?.id ?? null,
      gpu_label: gpu?.label ?? null,
      gpu_model: primaryGpuModel,
      gpu_vram_mb: primaryGpuVramMb,
      gpu_vram_gb: primaryGpuVramGb,
      gpu_tier: gpuTier,
      gpus: allGpus,
      nvidia_driver_version: nvidiaCheck?.driverVersion ?? null,
      nvidia_driver_supported: nvidiaCheck?.supported ?? null,
      amd_driver_version: amdDriver,
      intel_driver_version: intelDriver,
      os_distro: osDistro,
      os_release: osRelease,
      os_arch: osArch,
      cpu_physical_cores: cpuPhysicalCores,
      cpu_speed_ghz: cpuSpeedGhz,
      cpu_manufacturer: cpuManufacturer
    }
  }

  // Per-session boot census of every persisted installation, sorted
  // most-recently-launched first. Powers `comfy.desktop.session.installs_inventory`
  // so dashboards can see the user's full install footprint without
  // having to wait for them to launch each one. The inventory ships to PostHog
  // (only) as a serialized `installs_json` string; capped to 384 KB total to
  // leave conservative headroom under PostHog's 1 MB per-event hard limit after
  // re-escaping inside the outer event JSON, super-properties, and any non-ASCII
  // expansion (the cap counts UTF-16 code units, the limit is UTF-8 bytes).
  ipcMain.handle('get-installs-inventory', async () => {
    const MAX_TOTAL_BYTES = 384 * 1024
    const MAX_PER_INSTALL_BYTES = 64 * 1024
    const all = await installations.list()
    // `installing` entries are mid-install transient — exclude them
    // (they'll show up on the next boot once they settle).
    const visible = all.filter((i) => i.status !== 'installing')
    // Most-recently-launched first; never-launched (`undefined`) sort
    // to the end with `?? 0`.
    visible.sort(
      (a, b) =>
        ((b.lastLaunchedAt as number | undefined) ?? 0) -
        ((a.lastLaunchedAt as number | undefined) ?? 0)
    )

    const result = {
      total_install_count: visible.length,
      included_install_count: 0,
      truncated: false,
      installs: [] as Array<Record<string, unknown>>
    }
    let runningSize = JSON.stringify(result).length

    for (const inst of visible) {
      const entries = inst.installPath ? await listSnapshots(inst.installPath).catch(() => []) : []
      const latest = entries.length > 0 ? entries[0]!.snapshot : null

      const entry: Record<string, unknown> = {
        installation_id: inst.id,
        source_id: (inst.sourceId as string) || '',
        variant: (inst.variant as string) || '',
        update_channel: (inst.updateChannel as string) || 'stable',
        comfyui_version: (inst.comfyuiVersion as string) || '',
        snapshot_count: entries.length,
        last_launched_at: (inst.lastLaunchedAt as number | undefined) ?? null,
        latest_snapshot: latest
          ? {
              createdAt: latest.createdAt,
              trigger: latest.trigger,
              // User-typed snapshot labels can carry PII / paths /
              // model names, so we collapse the label to a presence
              // boolean instead of shipping the raw string.
              has_label: !!latest.label,
              comfyui: {
                ref: latest.comfyui.ref,
                commit: latest.comfyui.commit,
                releaseTag: latest.comfyui.releaseTag
              },
              custom_nodes_count: latest.customNodes.length,
              pip_packages_count: Object.keys(latest.pipPackages).length
            }
          : null,
        snapshot_diffs: [] as Array<Record<string, unknown>>
      }

      // Pack as many diffs (newest → oldest) as fit under the
      // per-install cap; truncation is tolerated silently to leave
      // room for the next install in the inventory.
      let perInstallSize = JSON.stringify(entry).length
      for (let i = 0; i < entries.length - 1; i++) {
        const newer = entries[i]!.snapshot
        const older = entries[i + 1]!.snapshot
        const d = diffSnapshots(older, newer)
        const diffEntry: Record<string, unknown> = {
          createdAt: newer.createdAt,
          trigger: newer.trigger,
          // Same PII reasoning as `latest_snapshot.has_label` above.
          has_label: !!newer.label,
          nodesAdded: d.nodesAdded.length,
          nodesRemoved: d.nodesRemoved.length,
          nodesChanged: d.nodesChanged.length,
          pipsAdded: d.pipsAdded.length,
          pipsRemoved: d.pipsRemoved.length,
          pipsChanged: d.pipsChanged.length,
          comfyuiChanged: d.comfyuiChanged,
          updateChannelChanged: d.updateChannelChanged
        }
        const diffSize = JSON.stringify(diffEntry).length + 1
        if (perInstallSize + diffSize > MAX_PER_INSTALL_BYTES) break
        ;(entry.snapshot_diffs as Array<Record<string, unknown>>).push(diffEntry)
        perInstallSize += diffSize
      }

      const entrySize = JSON.stringify(entry).length + 1
      if (runningSize + entrySize > MAX_TOTAL_BYTES) {
        result.truncated = true
        break
      }
      result.installs.push(entry)
      result.included_install_count += 1
      runningSize += entrySize
    }

    return result
  })

  ipcMain.handle('get-installation-dd-context', (_event, installationId: string) =>
    buildInstallationDdContext(installationId)
  )

  ipcMain.handle('get-device-id', () => getDeviceId())
}
