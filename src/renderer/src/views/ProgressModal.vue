<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, X, TriangleAlert, ChevronDown, ArrowLeft, RefreshCcw } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import { useModal } from '../composables/useModal'
import {
  useReturnToDashboardConfirm,
  type ReturnToDashboardReason
} from '../composables/useReturnToDashboardConfirm'
import { useInstallationStore } from '../stores/installationStore'
import { emitTelemetryAction } from '../lib/telemetry'

import { useTerminalScroll } from '../composables/useTerminalScroll'
import { useProgressStore } from '../stores/progressStore'
import type { ActionResult, KillResult, ShowProgressOpts } from '../types/ipc'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import BrandSceneAnimation from '../components/BrandSceneAnimation.vue'
import BrandProgressGlyph from '../components/icons/BrandProgressGlyph.vue'
import BaseAccordion from '../components/ui/BaseAccordion.vue'
import BaseCopyButton from '../components/ui/BaseCopyButton.vue'
import BrandProgressView from '../components/BrandProgressView.vue'
import InstallShowcase from '../components/InstallShowcase.vue'
import { useCloudGate } from '../composables/useCloudGate'
import type { ProgressStepVM } from '../lib/progressViewModel'
import { TID } from '../../../shared/testIds'

const footerButtonClass =
  'brand-progress__footer-btn static inline-flex min-w-auto appearance-auto items-center justify-center gap-1.5 rounded-md border border-solid px-3.5 py-[7px] font-sans text-[13px] leading-[inherit] font-medium whitespace-nowrap touch-auto transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 [@media(max-width:720px)]:px-2.5 [@media(max-width:720px)]:py-1.5 [@media(max-width:720px)]:text-[12px]'
const secondaryClass =
  'border-neutral-500 bg-transparent text-neutral-100 enabled:hover:bg-[var(--brand-surface-bg)] enabled:hover:text-neutral-100'
const primaryClass =
  'rounded-[var(--radius-control)] border-comfy-yellow bg-comfy-yellow text-neutral-900 enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] disabled:hover:bg-comfy-yellow focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))]'
const dangerClass =
  'brand-progress__footer-btn--danger hover:border-[var(--semantic-danger,#ff7a7a)] focus-visible:border-[var(--semantic-danger,#ff7a7a)] focus-visible:bg-[color-mix(in_srgb,var(--semantic-danger,#ff7a7a)_14%,transparent)] hover:focus-visible:bg-[var(--brand-surface-bg)]'

interface Props {
  installationId: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  'show-detail': [installationId: string]
  'show-console': [installationId: string]
  /** `successTerminal` ops resolve here instead of auto-closing; the host maps the action id to behaviour. */
  'success-choice': [actionId: string, installationId: string]
}>()

const { t, te } = useI18n()
const modal = useModal()
const progressStore = useProgressStore()
const installationStore = useInstallationStore()
const { confirmReturnToDashboard } = useReturnToDashboardConfirm()

const currentId = ref<string | null>(null)
const resolvingConflict = ref(false)
/** The port a "Stop process and retry" just failed to free: said under the conflict, which
 *  otherwise comes back unchanged. Cleared by anything that replaces the conflict. */
const killFailedPort = ref<number | null>(null)

const currentOp = computed(() => {
  const id = currentId.value ?? props.installationId
  if (!id) return null
  return progressStore.operations.get(id) ?? null
})

const displayId = computed(() => currentId.value ?? props.installationId)

// "Skip model download": shown only while the trailing `template-models` phase
// is the active row (every earlier install+launch step is therefore done) and
// the download is still in progress. Clicking hands the resume-capable task off
// to the title-bar downloads tray and lets the user into ComfyUI immediately.
const templateSkipped = ref(false)
const canSkipTemplateDownload = computed<boolean>(() => {
  if (templateSkipped.value) return false
  const op = currentOp.value
  if (!op || op.finished || op.activePhase !== 'template-models') return false
  // Only when it's genuinely still working — a finished/errored phase has
  // nothing to skip (the error substatus is the surface there).
  return !op.phaseErrors?.['template-models'] && globalProgress.value.percent < 100
})

async function handleSkipTemplateDownload(): Promise<void> {
  const id = displayId.value
  if (!id) return
  emitTelemetryAction('comfy.desktop.template.download.skipped', { flow: 'launch' })
  try {
    await window.api.skipTemplateDownload(id)
    // Mark consumed only on success, so a failed hand-off leaves the button live.
    templateSkipped.value = true
  } catch {
    // Best-effort hand-off; the download keeps running regardless.
  }
}

// A finished, successful INSTALL leg of a chain is NOT the end — the launch
// leg is about to take over. During this brief handoff we suppress the
// success banner and keep the in-progress bar+stepper mounted, so install →
// launch reads as one continuous stepper with no flash/remount seam.
const isChainHandoff = computed<boolean>(() => {
  const op = currentOp.value
  return !!op?.finished && !!op.result?.ok && op.chainSpan === 'install'
})

// True while a finished op has an unresolved, still-actionable port conflict (false once the user picks a fix and re-runs).
const isPortConflictOpen = computed<boolean>(() => {
  const op = currentOp.value
  if (!op?.finished) return false
  if (resolvingConflict.value) return false
  const conflict = op.result?.portConflict
  if (!conflict) return false
  if (op.result?.ok) return false
  return true
})

// Error / port-conflict detail under the finished banner. Centralised so the gate and the copy value can't drift. Null in any non-error terminal state.
const finishedErrorMessage = computed<string | null>(() => {
  const op = currentOp.value
  if (!op?.finished) return null
  if (op.cancelRequested) return null
  if (isPortConflictOpen.value) {
    const message = op.result?.message ?? null
    const port = op.result?.portConflict?.port
    if (message && port != null && killFailedPort.value === port) {
      return `${message}\n\n${t('errors.portConflictKillFailed', { port })}`
    }
    return message
  }
  if (op.error) return op.error
  return null
})

// Unified 0→100 progress via `progressStore.globalProgressFor` (handles flat/stepped + monotonic clamp).
const globalProgress = computed<{ percent: number; indeterminate: boolean }>(() => {
  const op = currentOp.value
  if (!op) return { percent: 0, indeterminate: true }
  return progressStore.globalProgressFor(op)
})

// Friendly label registered by main via `sendProgress('steps', { steps })` for the active phase (used by the adopt/migration flow).
const activeStepLabel = computed<string | null>(() => {
  const op = currentOp.value
  if (!op?.steps || !op.activePhase) return null
  return op.steps.find((s) => s.phase === op.activePhase)?.label?.trim() || null
})

function meaningfulStepLabel(phase: string, fallback?: string | null): string | null {
  const label = fallback?.trim()
  if (!label) return null
  return label.toLowerCase() === phase.toLowerCase() ? null : label
}

function localizedPhaseLabel(phase: string): string | null {
  const key = `progress.phaseLabel.${phase}`
  return te(key) ? t(key) : null
}

// Live sub-status for the active phase. Main may push either a literal
// (e.g. node count "3 / 7 · Manager") or an i18n key (`launch.activity.*`,
// translated here so the tracker stays locale-agnostic). Keys that don't
// resolve fall back to null rather than leaking a dev-y slug.
const activePhaseStatus = computed<string | null>(() => {
  const op = currentOp.value
  if (!op?.steps || !op.activePhase) return null
  const raw = op.lastStatus[op.activePhase]?.trim()
  if (!raw) return null
  if (/^[a-z][\w-]*(?:\.[\w-]+)+$/i.test(raw)) {
    const translated = t(raw)
    return translated !== raw ? translated : null
  }
  return raw
})

// User-facing caption per phase. Meaningful registered labels win for dynamic
// phases; generic labels fall through to curated locale labels.
const friendlyCaption = computed<string>(() => {
  const op = currentOp.value
  if (!op) return t('progress.starting')
  if (op.steps && op.activePhase) {
    const meaningful = meaningfulStepLabel(op.activePhase, activeStepLabel.value)
    if (meaningful) return meaningful
    const friendly = localizedPhaseLabel(op.activePhase)
    if (friendly) return friendly
    if (activeStepLabel.value) return activeStepLabel.value
    const raw = activePhaseStatus.value
    if (raw && raw !== op.activePhase) return raw
    return op.activePhase
  }
  return op.flatStatus || t('progress.starting')
})

// Second-line caption: rich `lastStatus[activePhase]` (bytes/speed/ETA) when it adds info beyond the headline. Suppresses the raw phase-id fallback so dev-y slugs never leak in as a sub-label.
const subStatus = computed<string | null>(() => {
  const raw = activePhaseStatus.value
  if (!raw) return null
  const op = currentOp.value
  if (op?.activePhase && raw === op.activePhase) return null
  if (raw === activeStepLabel.value) return null
  if (raw === friendlyCaption.value) return null
  return raw
})

// Polish the rich substatus: group byte counts (lookahead scoped to a byte unit so ports/PIDs aren't mangled), drop a collapsed "· 0s remaining" tail, fix the leftover separator.
const formattedSubStatus = computed<string | null>(() => {
  const raw = subStatus.value
  if (!raw) return null
  return (
    raw
      .replace(/(\d{4,})(?=\s*(?:GB|MB|KB|B)\b)/gi, (_, n) => Number(n).toLocaleString())
      .replace(/\s*·\s*(?:0s?|—)\s*remaining/gi, '')
      .replace(/\s*·\s*·\s*/g, '  ·  ')
      .replace(/\s*·\s*$/, '')
      .trim() || null
  )
})

// The bar binds DIRECTLY to the store's real percent — no creep, no synthetic
// motion. The store already clamps monotonically (`_globalFloor`) so the value
// only ever moves forward, and only on real log milestones. During a silent
// gap (e.g. the ~110s GPU/torch init) the bar simply HOLDS; the active step's
// spinner conveys "working". Honest by construction.
const displayedPercent = computed<number>(() => globalProgress.value.percent)

// Resolve a step's display label without leaking dynamic phase slugs.
function stepLabel(phase: string, fallback?: string): string {
  return (
    meaningfulStepLabel(phase, fallback) ?? localizedPhaseLabel(phase) ?? fallback?.trim() ?? phase
  )
}

// Two-level step rows for the swappable progress view, rendered as ONE
// continuous list across a chain: the completed prior leg (`priorSteps`, e.g.
// install) is prepended as done steps, then the current op's steps. So
// install → launch reads as a single stepper with no seam and the user can
// see the next step coming. Steps before the active one are `done`, the
// active one carries the live sub-activity, the rest are `pending`.
const progressSteps = computed<ProgressStepVM[]>(() => {
  const op = currentOp.value
  if (!op) return []

  const prior: ProgressStepVM[] = (op.priorSteps ?? []).map((step) => ({
    phase: step.phase,
    label: stepLabel(step.phase, step.label),
    status: 'done' as const,
    detail: null,
    subPercent: null,
    isError: false
  }))

  // Launch leg's steps haven't arrived yet (IPC in flight) but the prior leg
  // exists — keep the merged stepper on screen with a synthetic active
  // "Starting ComfyUI…" tail so there's no flash back to the flat caption.
  if (!op.steps?.length) {
    if (!prior.length) return []
    return [
      ...prior,
      {
        phase: 'launchStart',
        label: stepLabel('launchStart'),
        status: 'active' as const,
        detail: null,
        subPercent: null,
        isError: false
      }
    ]
  }

  const activeIdx = op.activePhase ? op.steps.findIndex((s) => s.phase === op.activePhase) : -1
  const current: ProgressStepVM[] = op.steps.map((step, i) => {
    const status: ProgressStepVM['status'] = op.finished
      ? 'done'
      : activeIdx < 0
        ? i === 0
          ? 'active'
          : 'pending'
        : i < activeIdx
          ? 'done'
          : i === activeIdx
            ? 'active'
            : 'pending'
    return {
      phase: step.phase,
      label: stepLabel(step.phase, step.label),
      status,
      detail: status === 'active' ? formattedSubStatus.value : null,
      subPercent:
        status === 'active' && !globalProgress.value.indeterminate ? op.activePercent : null,
      isError: status === 'active' && op.phaseErrors?.[step.phase] === true
    }
  })

  return [...prior, ...current]
})

const cloudGate = useCloudGate()
async function handleShowcaseCloud(): Promise<void> {
  emitTelemetryAction('comfy.desktop.install.showcase.cloud_open', {
    phase: currentOp.value?.activePhase ?? null
  })
  // A silent no-op reads as a dead button, so a failed launch says so.
  if (await cloudGate.openCloud()) return
  await modal.alert({
    title: t('installShowcase.cloudFailedTitle'),
    message: t('installShowcase.cloudFailedMessage')
  })
}

/** Brand centrepiece for any still-working op, whatever its kind. */
const showScene = computed<boolean>(() => {
  const op = currentOp.value
  if (!op) return false
  return !op.finished || isChainHandoff.value
})

/** Cloud upsell, install-only: rides both legs of the install chain. */
const showShowcase = computed<boolean>(() => {
  const op = currentOp.value
  if (!op) return false
  const isInstallWait = op.opKind === 'install' || op.chainSpan === 'launch'
  return isInstallWait && (!op.finished || isChainHandoff.value)
})

// Separate from the modal-branch `terminalExpanded` so the brand accordion's state doesn't leak into the modal reopen path.
const brandLogsExpanded = ref(false)
const brandTerminalRef = ref<HTMLDivElement | null>(null)
// Gate the getter while the accordion is closed so the two live `useTerminalScroll` instances don't both wake on every stdout chunk and scroll a null ref.
const { isAtBottom: brandIsAtBottom, handleTerminalScroll: handleBrandTerminalScroll } =
  useTerminalScroll(brandTerminalRef, () =>
    brandLogsExpanded.value ? currentOp.value?.terminalOutput : undefined
  )

function toggleBrandLogs(): void {
  brandLogsExpanded.value = !brandLogsExpanded.value
}

// Each op starts with the logs accordion closed and a fresh skip state.
watch(displayId, () => {
  brandLogsExpanded.value = false
  brandIsAtBottom.value = true
  templateSkipped.value = false
})

// Auto-expand the logs panel when an operation finishes with an error so the full
// substep output is visible immediately, instead of the user having to discover
// the collapsed "View logs" toggle to find out why an update/restore/migrate failed.
// `immediate` covers reopening an already-failed op; the logs accordion itself is
// gated on `terminalOutput`, so expanding when there's nothing to show is harmless.
watch(
  finishedErrorMessage,
  (msg) => {
    if (msg) brandLogsExpanded.value = true
  },
  { immediate: true }
)

// Render only a trailing window; the store keeps the full buffer for telemetry. Rendering megabytes into one text node re-layouts the whole takeover.
const MAX_LOG_TAIL_CHARS = 256 * 1024
const displayedTerminalOutput = computed(() => {
  const s = currentOp.value?.terminalOutput ?? ''
  return s.length > MAX_LOG_TAIL_CHARS ? s.slice(-MAX_LOG_TAIL_CHARS) : s
})

// Copy returns the FULL buffer (not the truncated render copy); materialised at click time.
function getTerminalLogText(): string {
  return currentOp.value?.terminalOutput ?? ''
}

// Sync currentId with prop
watch(
  () => props.installationId,
  (id) => {
    if (id) {
      currentId.value = id
    }
  },
  { immediate: true }
)

function showOperation(installationId: string): void {
  const op = progressStore.operations.get(installationId)
  if (!op) return
  currentId.value = installationId
}

function startOperation(opts: {
  installationId: string
  title: string
  apiCall: () => Promise<ActionResult>
  cancellable?: boolean
  returnTo?: string
  opKind?: ShowProgressOpts['opKind']
  destroysInstance?: boolean
  /** Forwarded to the store so a host driving the modal via the exposed handle can still set up an install→launch chain. */
  chainSpan?: ShowProgressOpts['chainSpan']
  successTerminal?: ShowProgressOpts['successTerminal']
}): void {
  currentId.value = opts.installationId
  resolvingConflict.value = false
  progressStore.startOperation(opts)
}

// True when a successful op is parked on its terminal-choice screen; gates the footer swap and auto-close.
const successTerminalActive = computed<boolean>(() => {
  const op = currentOp.value
  if (!op?.finished) return false
  if (!op.result?.ok) return false
  if (op.error) return false
  if (op.cancelRequested) return false
  return !!op.successTerminal
})

function handleSuccessChoice(actionId: string): void {
  const id = displayId.value
  if (!id) return
  emit('success-choice', actionId, id)
  emit('close')
}

// Window-mode launches close instantly so the new comfy window takes focus; other op kinds auto-close via the delayed `handleDone` watcher below.
watch(
  () => {
    const id = displayId.value
    if (!id) return null
    const op = progressStore.operations.get(id)
    if (!op) return null
    return op.finished && op.result?.ok && op.result.mode === 'window' ? id : null
  },
  (autoCloseId) => {
    if (autoCloseId && displayId.value === autoCloseId && props.installationId !== null) {
      emit('close')
    }
  }
)

function handleDone(): void {
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op?.result) return
  // Destroy ops: detach the host before closing so it isn't left pointing at a now-removed install.
  if (op.destroysInstance) {
    void window.api.returnToDashboard()
  }
  emit('close')
  // copy / copy-update / release-update produced a new install — open it in its own window; the source host stays put.
  const newInstallationId = op.result.newInstallationId
  if (newInstallationId) {
    void window.api.openInstallWindow(newInstallationId)
    return
  }
  // Guard show-detail against a stale id (destroy ops would route to a missing detail view).
  const installStillExists = !!installationStore.getById(id)
  if (installStillExists && (op.returnTo === 'detail' || op.result.navigate === 'detail')) {
    emit('show-detail', id)
  } else if (op.result.mode === 'console') {
    emit('show-console', id)
  }
}

// Return-to-Dashboard from any op state. In-flight always prompts (returning cancels the operation, even when the installing record is hidden from the list); idle states skip it. Flips an install-backed window back to chooser mode in place.
async function returnToDashboard(reason: ReturnToDashboardReason): Promise<void> {
  const id = displayId.value
  const op = id ? progressStore.operations.get(id) : null
  const installation = id ? (installationStore.getById(id) ?? null) : null
  // No-op for the finished branches; only the in-flight footer button surfaces the prompt.
  const ok = await confirmReturnToDashboard(installation, reason)
  if (!ok) return
  if (reason === 'in_flight' && op && !op.finished && id) {
    progressStore.cancelOperation(id)
  }
  emitTelemetryAction('comfy.desktop.instance.return_to_dashboard', { from: 'progress', reason })
  emit('close')
  // No-op when the host isn't install-backed (chooser launches that errored before the swap).
  await window.api.returnToDashboard()
}

// Re-run the errored op: feed the stored `apiCall` (or a fresh `runAction('launch')`) back into `startOperation`.
function handleReboot(): void {
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op) return
  startOperation({
    installationId: id,
    title: op.title,
    apiCall: op.apiCall || (() => window.api.runAction(id, 'launch')),
    returnTo: op.returnTo,
    opKind: op.opKind,
    destroysInstance: op.destroysInstance
  })
}

// Cancel an in-flight destroy op, gated by the local-install confirm (a cancelled delete leaves the install partial). Host stays put rather than auto-detaching.
async function cancelDestructiveOp(): Promise<void> {
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op || op.finished) return
  const installation = installationStore.getById(id) ?? null
  const ok = await confirmReturnToDashboard(installation, 'in_flight')
  if (!ok) return
  emitTelemetryAction('comfy.desktop.instance.return_to_dashboard', {
    from: 'progress',
    reason: 'in_flight'
  })
  progressStore.cancelOperation(id)
  emit('close')
}

// Auto-close on success/cancel after a short delay (lets the banner register), then run `handleDone`. Errors don't auto-close.
const AUTO_CLOSE_DELAY_MS = 700
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
function clearAutoCloseTimer(): void {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
}
watch(
  () => {
    const op = currentOp.value
    if (!op?.finished) return null
    if (op.error) return null
    if (op.result?.portConflict) return null
    // successTerminal parks on a choice screen; auto-close would race and dismiss it before it's readable.
    if (successTerminalActive.value) return null
    return displayId.value
  },
  (id) => {
    clearAutoCloseTimer()
    if (!id) return
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null
      if (displayId.value === id) handleDone()
    }, AUTO_CLOSE_DELAY_MS)
  }
)
onBeforeUnmount(clearAutoCloseTimer)

function handleUseNextPort(nextPort: number): void {
  if (resolvingConflict.value) return
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op) return
  resolvingConflict.value = true
  startOperation({
    installationId: id,
    title: op.title,
    apiCall: () => window.api.runAction(id, 'launch', { portOverride: nextPort }),
    returnTo: op.returnTo
  })
}

// An earlier ComfyUI of this install still running a prompt: stopping goes back through launch,
// which re-proves the process is ours before stopping it (never a kill by port).
async function handleStopBusyPrior(): Promise<void> {
  if (resolvingConflict.value) return
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op) return
  const unknown = op.result?.portConflict?.priorUnknown === true
  const survivors = op.result?.portConflict?.priorSurvivors === true
  const confirmed = await modal.confirm({
    title: t(
      survivors
        ? 'errors.priorSurvivorsTitle'
        : unknown
          ? 'errors.priorProcessUnknownTitle'
          : 'errors.priorProcessBusyTitle'
    ),
    message: t(
      survivors
        ? 'errors.priorSurvivorsConfirmMessage'
        : unknown
          ? 'errors.priorProcessUnknownConfirmMessage'
          : 'errors.priorProcessBusyConfirmMessage'
    ),
    confirmLabel: t(survivors ? 'errors.priorSurvivorsStop' : 'errors.priorProcessBusyStop'),
    confirmStyle: 'danger'
  })
  if (!confirmed) return
  resolvingConflict.value = true
  startOperation({
    installationId: id,
    title: op.title,
    apiCall: () => window.api.runAction(id, 'launch', { stopBusyPriorProcess: true }),
    returnTo: op.returnTo
  })
}

async function handleKillProcess(port: number): Promise<void> {
  if (resolvingConflict.value) return
  const id = displayId.value
  if (!id) return
  const op = progressStore.operations.get(id)
  if (!op) return
  if (op.result?.portConflict?.priorBusy) return handleStopBusyPrior()
  const confirmed = await modal.confirm({
    title: t('errors.portConflictKillConfirmTitle'),
    message: t('errors.portConflictKillConfirmMessage'),
    confirmLabel: t('errors.portConflictKill'),
    confirmStyle: 'danger'
  })
  if (!confirmed) return
  resolvingConflict.value = true

  killFailedPort.value = null
  const killResult: KillResult = await window.api.killPortProcess(port)
  if (killResult.ok) {
    startOperation({
      installationId: id,
      title: op.title,
      apiCall: op.apiCall || (() => window.api.runAction(id, 'launch')),
      returnTo: op.returnTo
    })
  } else {
    killFailedPort.value = port
    resolvingConflict.value = false
  }
}

watch(
  () => currentOp.value?.result,
  () => {
    killFailedPort.value = null
  }
)

defineExpose({ startOperation, showOperation })
</script>

<template>
  <BrandTakeoverLayout v-if="installationId && currentOp">
    <template #logo-right>
      <InstallShowcase
        v-if="showShowcase"
        :can-offer-cloud="cloudGate.canOffer.value"
        @open-cloud="handleShowcaseCloud"
      />
    </template>
    <div
      class="brand-progress relative flex w-full flex-auto items-center justify-center self-stretch pb-[clamp(88px,12vh,148px)] before:pointer-events-none before:absolute before:top-1/2 before:left-1/2 before:z-1 before:size-[clamp(340px,48vw,760px)] before:rounded-[50%] before:bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--neutral-950)_58%,transparent)_0%,color-mix(in_srgb,var(--neutral-950)_28%,transparent)_32%,color-mix(in_srgb,var(--neutral-950)_9%,transparent)_56%,transparent_76%)] before:content-[''] before:[filter:blur(40px)] before:[transform:translate(-50%,-50%)]"
    >
      <div
        class="brand-progress__beam-anchor pointer-events-none absolute top-1/2 left-1/2 size-0 [anchor-name:--brand-beam-target]"
        aria-hidden="true"
      />
      <BrandProgressGlyph
        class="brand-progress__glyph pointer-events-none absolute top-1/2 left-[60%] z-0 h-screen w-auto opacity-90 [transform:translate(-50%,-50%)]"
        aria-hidden="true"
      />
      <div
        class="brand-progress__stack relative z-2 flex w-[min(85%,880px)] max-w-[calc(100vw-48px)] flex-col items-center gap-[clamp(0.75rem,1.8vh,1.125rem)] overflow-visible text-center"
      >
        <!-- Plate wraps logo + status and carries the radial scrim that knocks
             back the yellow glyph so stepper text stays legible. -->
        <div
          class="brand-progress__plate relative isolate w-full before:pointer-events-none before:absolute before:top-[46%] before:left-1/2 before:-z-1 before:h-[min(340%,34rem)] before:w-[min(148%,38rem)] before:rounded-[50%] before:bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--neutral-800)_58%,transparent)_0%,color-mix(in_srgb,var(--neutral-800)_38%,transparent)_34%,transparent_62%)] before:content-[''] before:[transform:translate(-50%,-50%)]"
        >
          <div
            class="brand-progress__core relative z-1 flex w-full flex-col items-center gap-[clamp(0.75rem,1.8vh,1.125rem)]"
          >
            <div
              v-if="showScene"
              class="brand-progress__scene relative aspect-[1056/784] w-[min(52vw,620px)] overflow-hidden rounded-2xl"
            >
              <BrandSceneAnimation />
            </div>

            <template v-if="!currentOp.finished || isChainHandoff">
              <div class="brand-progress__bar-wrap flex w-full flex-col gap-1">
                <!-- Determinate fill bound directly to the store's real
                     percent — moves only on log milestones, holds during gaps. -->
                <div
                  class="brand-progress__bar h-[5.079px] w-full overflow-hidden rounded-2xl bg-[var(--brand-surface-bg)]"
                >
                  <div
                    class="brand-progress__bar-fill h-full rounded-[inherit] bg-comfy-yellow transition-[width] duration-420 ease-[cubic-bezier(0.33,0,0.2,1)] motion-reduce:transition-none"
                    :style="{ width: `${displayedPercent}%` }"
                  />
                </div>
                <div
                  class="brand-progress__percent self-end text-[11px] leading-none tracking-[0.02em] text-neutral-100 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]"
                  aria-hidden="true"
                >
                  {{ Math.round(displayedPercent) }}%
                </div>
              </div>
            </template>

            <Transition
              v-if="currentOp.finished && !isChainHandoff"
              name="brand-caption-fade"
              mode="out-in"
              enter-active-class="brand-caption-fade-enter-active transition-[opacity,transform] duration-180 ease-[ease] motion-reduce:duration-0"
              leave-active-class="brand-caption-fade-leave-active transition-[opacity,transform] duration-180 ease-[ease] motion-reduce:duration-0"
              enter-from-class="brand-caption-fade-enter-from opacity-0 [transform:translateY(4px)] motion-reduce:[transform:none]"
              leave-to-class="brand-caption-fade-leave-to opacity-0 [transform:translateY(-4px)] motion-reduce:[transform:none]"
            >
              <div
                v-if="isPortConflictOpen"
                key="finished-port-conflict"
                class="brand-progress__banner inline-flex min-h-[1.5em] items-center gap-2.5 text-[length:var(--takeover-fs-body)] tracking-[0.01em] text-neutral-200 [&_svg]:flex-none brand-progress__banner--error [&]:text-[var(--semantic-danger,#ff7a7a)]"
                :data-testid="TID.progressPortConflictBanner"
                aria-live="polite"
              >
                <X :size="20" />
                <span>{{
                  currentOp.result?.portConflict?.priorBusy &&
                  currentOp.result.portConflict.priorSurvivors
                    ? $t('errors.priorSurvivorsTitle')
                    : currentOp.result?.portConflict?.priorBusy &&
                        currentOp.result.portConflict.priorUnknown
                      ? $t('errors.priorProcessUnknownTitle')
                      : currentOp.result?.portConflict?.priorBusy
                        ? $t('errors.priorProcessBusyTitle')
                        : $t('errors.portConflictTitle')
                }}</span>
              </div>
              <div
                v-else
                :key="`finished-${
                  currentOp.cancelRequested ? 'cancelled' : currentOp.error ? 'error' : 'success'
                }`"
                class="brand-progress__banner inline-flex min-h-[1.5em] items-center gap-2.5 text-[length:var(--takeover-fs-body)] tracking-[0.01em] text-neutral-200 [&_svg]:flex-none"
                :class="{
                  'brand-progress__banner--success [&]:text-[var(--semantic-success,var(--neutral-50))]':
                    !currentOp.cancelRequested && currentOp.result?.ok,
                  'brand-progress__banner--error [&]:text-[var(--semantic-danger,#ff7a7a)]':
                    !currentOp.cancelRequested && !!currentOp.error,
                  'brand-progress__banner--cancelled [&]:text-neutral-300':
                    currentOp.cancelRequested
                }"
                aria-live="polite"
              >
                <Check v-if="!currentOp.cancelRequested && currentOp.result?.ok" :size="20" />
                <X v-else-if="!currentOp.cancelRequested" :size="20" />
                <TriangleAlert v-else :size="20" />
                <span>
                  {{
                    currentOp.cancelRequested
                      ? $t('progress.completedCancelled')
                      : currentOp.result?.ok
                        ? (currentOp.successTerminal?.title ?? $t('progress.completedSuccess'))
                        : $t('progress.completedError')
                  }}
                </span>
              </div>
            </Transition>

            <div
              v-if="!currentOp.finished || isChainHandoff"
              class="brand-progress__status absolute top-[calc(100%+0.625rem)] left-1/2 z-1 w-full [transform:translateX(-50%)]"
            >
              <Transition
                name="brand-status-fade"
                mode="out-in"
                enter-active-class="brand-status-fade-enter-active transition-opacity duration-180 ease-[ease] motion-reduce:duration-0"
                leave-active-class="brand-status-fade-leave-active transition-opacity duration-180 ease-[ease] motion-reduce:duration-0"
                enter-from-class="brand-status-fade-enter-from opacity-0"
                leave-to-class="brand-status-fade-leave-to opacity-0"
              >
                <BrandProgressView
                  v-if="progressSteps.length"
                  key="stepper"
                  :steps="progressSteps"
                  class="brand-progress__steps w-full"
                />
                <div
                  v-else
                  key="caption"
                  class="brand-progress__status-flat flex flex-col items-center gap-1"
                >
                  <div
                    class="brand-progress__caption min-h-[1.35em] text-center text-[length:var(--takeover-fs-body)] leading-[1.35] text-neutral-200 select-text [text-shadow:0_1px_2px_oklch(0_0_0/0.65)]"
                    aria-live="polite"
                  >
                    {{ friendlyCaption }}
                  </div>
                  <div
                    v-if="formattedSubStatus"
                    class="brand-progress__substatus text-center text-[length:var(--takeover-fs-caption,12px)] leading-[1.35] tracking-[0.01em] text-neutral-200 tabular-nums select-text [text-shadow:0_1px_2px_oklch(0_0_0/0.65)]"
                    aria-live="polite"
                  >
                    {{ formattedSubStatus }}
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Success terminal actions, outside the caption Transition so it isn't a second child. -->
        <div
          v-if="successTerminalActive && currentOp.successTerminal"
          class="brand-progress__terminal-actions flex flex-row flex-wrap items-center justify-center gap-3"
        >
          <Button
            v-for="action in currentOp.successTerminal.actions"
            :key="action.id"
            size="unset"
            variant="textonly"
            type="button"
            :class="[
              footerButtonClass,
              action.variant === 'primary' ? primaryClass : secondaryClass
            ]"
            @click="handleSuccessChoice(action.id)"
          >
            {{ action.label }}
          </Button>
        </div>

        <!-- Error / port-conflict detail beneath the banner. Copy writes the same string shown. -->
        <div
          v-if="finishedErrorMessage"
          class="brand-progress__error-row -mt-1 flex w-full max-w-[640px] items-start gap-2"
        >
          <div
            class="brand-progress__error-message mt-0 max-h-[clamp(120px,22vh,240px)] w-full max-w-[640px] flex-auto overflow-y-auto overscroll-contain rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-3.5 py-3 text-left text-[13px] leading-[1.55] whitespace-pre-wrap text-neutral-200 select-text [word-break:break-word]"
            :data-testid="TID.progressErrorMessage"
          >
            {{ finishedErrorMessage }}
          </div>
          <BaseCopyButton
            :value="finishedErrorMessage"
            :aria-label="$t('common.copy')"
            class="brand-progress__error-copy mt-1 flex-none"
          />
        </div>

        <!-- Error actions in the hero stack, keeping the Reboot CTA with the failure context. -->
        <div
          v-if="
            currentOp.finished &&
            !!currentOp.error &&
            !currentOp.cancelRequested &&
            !isPortConflictOpen
          "
          class="brand-progress__error-actions flex w-full max-w-[420px] flex-row items-stretch gap-3 [&>.brand-progress\_\_footer-btn]:flex-1 [&>.brand-progress\_\_footer-btn]:justify-center"
        >
          <Button
            size="unset"
            variant="textonly"
            type="button"
            :class="[footerButtonClass, currentOp.destroysInstance ? primaryClass : secondaryClass]"
            :data-testid="TID.progressBack"
            @click="returnToDashboard('crashed')"
          >
            <ArrowLeft :size="14" />
            {{ $t('common.back') }}
          </Button>
          <Button
            v-if="!currentOp.destroysInstance"
            size="unset"
            variant="textonly"
            type="button"
            :class="[footerButtonClass, primaryClass]"
            :data-testid="TID.progressReboot"
            @click="handleReboot"
          >
            <RefreshCcw :size="14" />
            <!-- A launch's retry restarts ComfyUI, not the computer some errors mention. -->
            {{
              currentOp.opKind === 'launch' ? $t('progress.restartComfyui') : $t('progress.reboot')
            }}
          </Button>
        </div>
      </div>
    </div>
    <!-- Footer band pinned to the takeover's bottom edge. In-flight → Return to Dashboard; port conflict → Use-Port / Kill-Process; error → Reboot + Return. Empty (collapsed) on success/cancel. -->
    <template #footer>
      <div
        v-if="currentOp"
        class="brand-progress__footer pointer-events-none absolute top-[clamp(72px,14vh,160px)] right-[clamp(16px,2.5vw,32px)] bottom-[clamp(16px,2.5vh,32px)] left-[clamp(16px,2.5vw,32px)] z-3 flex min-h-0 flex-col justify-end gap-2 [&>*]:pointer-events-auto"
      >
        <!-- Log panel (opens above the footer bar) -->
        <BaseAccordion
          v-if="currentOp.terminalOutput"
          :open="brandLogsExpanded"
          class="brand-progress__logs-wrap min-h-0 overflow-hidden rounded-[10px]"
          :class="{
            'is-expanded border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] backdrop-blur-[8px]':
              brandLogsExpanded
          }"
        >
          <div
            class="brand-progress__logs-panel-header flex items-center justify-between border-b border-solid border-[var(--brand-surface-border)] px-3 py-2"
          >
            <span
              class="brand-progress__logs-panel-title text-[length:var(--takeover-fs-caption,12px)] font-medium text-neutral-200"
              >{{ $t('launch.viewLogs') }}</span
            >
            <BaseCopyButton
              :get-value="getTerminalLogText"
              :aria-label="$t('common.copy')"
              class="brand-progress__logs-copy flex-none"
            />
          </div>
          <div
            id="brand-progress-logs"
            ref="brandTerminalRef"
            class="brand-progress__logs min-h-0 max-h-[clamp(88px,25vh,260px)] w-full overflow-y-auto overscroll-contain px-3.5 py-3 text-left text-[11px] leading-[1.55] whitespace-pre-wrap text-neutral-300 select-text [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] [word-break:break-word]"
            :data-testid="TID.progressLogs"
            @scroll="handleBrandTerminalScroll"
          >
            {{ displayedTerminalOutput }}
          </div>
        </BaseAccordion>
        <div class="brand-progress__footer-bar flex flex-wrap items-center justify-between gap-3">
          <div class="brand-progress__footer-left inline-flex items-center gap-2.5">
            <template v-if="!currentOp.finished">
              <Button
                v-if="currentOp.destroysInstance"
                size="unset"
                variant="textonly"
                type="button"
                :class="[footerButtonClass, secondaryClass]"
                @click="cancelDestructiveOp"
              >
                <X :size="14" />
                {{ $t('common.cancel') }}
              </Button>
              <Button
                v-else
                size="unset"
                variant="textonly"
                type="button"
                :class="[footerButtonClass, secondaryClass]"
                @click="returnToDashboard('in_flight')"
              >
                <ArrowLeft :size="14" />
                {{ $t('progress.returnToDashboard') }}
              </Button>
            </template>
            <template v-else-if="isPortConflictOpen && currentOp.result?.portConflict">
              <Button
                size="unset"
                variant="textonly"
                type="button"
                :class="[footerButtonClass, secondaryClass]"
                @click="returnToDashboard('crashed')"
              >
                <ArrowLeft :size="14" />
                {{ $t('progress.returnToDashboard') }}
              </Button>
              <Button
                v-if="currentOp.result.portConflict.nextPort"
                size="unset"
                variant="textonly"
                type="button"
                :class="[footerButtonClass, primaryClass]"
                :data-testid="TID.progressPortConflictUsePort"
                @click="handleUseNextPort(currentOp.result.portConflict.nextPort!)"
              >
                {{ $t('errors.portConflictUsePort') }}
              </Button>
              <Button
                v-if="currentOp.result.portConflict.isComfy"
                size="unset"
                variant="textonly"
                type="button"
                :class="[footerButtonClass, secondaryClass, dangerClass]"
                :data-testid="TID.progressPortConflictKill"
                @click="handleKillProcess(currentOp.result.portConflict.port)"
              >
                {{
                  currentOp.result.portConflict.priorBusy
                    ? currentOp.result.portConflict.priorSurvivors
                      ? $t('errors.priorSurvivorsStop')
                      : $t('errors.priorProcessBusyStop')
                    : $t('errors.portConflictKill')
                }}
              </Button>
            </template>
          </div>
          <Button
            v-if="canSkipTemplateDownload"
            size="unset"
            variant="textonly"
            type="button"
            class="brand-progress__footer-skip mx-auto"
            :class="[footerButtonClass, secondaryClass]"
            @click="handleSkipTemplateDownload"
          >
            {{ $t('standalone.skipTemplateDownloadOpen') }}
          </Button>
          <Button
            v-if="currentOp.terminalOutput"
            size="unset"
            variant="textonly"
            type="button"
            class="brand-progress__logs-toggle bg-[rgba(138,134,136,0.1)] backdrop-blur-[75px] [box-shadow:0_1px_0_0_rgba(255,255,255,0.1)_inset] focus-visible:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
            :class="[footerButtonClass, secondaryClass, 'bg-[rgba(138,134,136,0.1)]']"
            :aria-expanded="brandLogsExpanded"
            aria-controls="brand-progress-logs"
            @click="toggleBrandLogs"
          >
            <ChevronDown
              :size="14"
              class="brand-progress__logs-chevron transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
              :class="
                brandLogsExpanded
                  ? 'is-open [transform:rotate(0deg)]'
                  : '[transform:rotate(180deg)]'
              "
            />
            {{ $t('launch.viewLogs') }}
          </Button>
        </div>
      </div>
    </template>
  </BrandTakeoverLayout>
</template>
