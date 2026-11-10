export { IN_PLACE_RELAUNCH } from '../../../types/ipc'

export function augmentMessageWithStopWarning(
  existing: string | undefined,
  willStopRunning: string
): string {
  if (!existing) return willStopRunning
  return `${willStopRunning}\n\n${existing}`
}

interface ActionLike {
  label: string
  confirm?: { message?: string; title?: string }
  prompt?: { message?: string }
}

export function augmentActionWithStopWarning<T extends ActionLike>(
  action: T,
  willStopRunning: string
): T {
  let mut: T = action
  if (mut.confirm) {
    mut = {
      ...mut,
      confirm: {
        ...mut.confirm,
        message: augmentMessageWithStopWarning(mut.confirm.message, willStopRunning)
      }
    }
  }
  if (mut.prompt) {
    mut = {
      ...mut,
      prompt: {
        ...mut.prompt,
        message: augmentMessageWithStopWarning(mut.prompt.message, willStopRunning)
      }
    }
  }
  if (!mut.confirm && !mut.prompt) {
    mut = {
      ...mut,
      confirm: { title: mut.label, message: willStopRunning }
    }
  }
  return mut
}

export async function stopAndWaitForExit(
  installationId: string,
  isRunning: () => boolean
): Promise<void> {
  await window.api.stopComfyUI(installationId)
  const deadline = Date.now() + 10_000
  while (isRunning() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
}
