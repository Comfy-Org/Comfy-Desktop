import type { AddFailureReason } from '../types/ipc'

interface AddFailure {
  message?: string
  reason?: AddFailureReason
}

interface AddFailureModal {
  alert: (opts: { title: string; message: string }) => Promise<void>
  notice: (opts: { title: string; message: string; actionLabel: string }) => Promise<boolean>
}

export async function alertAddFailure(opts: {
  modal: AddFailureModal
  t: (key: string) => string
  title: string
  failure: AddFailure
  onChangeLocation?: () => unknown
}): Promise<void> {
  const title = opts.title
  const message = opts.failure.message || opts.t('errors.cannotAddDetail')
  const changeLocation = opts.failure.reason === 'location' ? opts.onChangeLocation : undefined
  if (!changeLocation) {
    await opts.modal.alert({ title, message })
    return
  }
  const pressed = await opts.modal.notice({
    title,
    message,
    actionLabel: opts.t('errors.changeLocation')
  })
  if (pressed) await changeLocation()
}
