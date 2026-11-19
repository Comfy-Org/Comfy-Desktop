import type { AddFailureReason } from '../types/ipc'

interface AddFailure {
  message?: string
  reason?: AddFailureReason
}

interface NoticeFn {
  (opts: { title: string; message: string; actionLabel?: string }): Promise<boolean>
}

export async function alertAddFailure(opts: {
  notice: NoticeFn
  t: (key: string) => string
  title: string
  failure: AddFailure
  onChangeLocation?: () => unknown
}): Promise<void> {
  const canChangeLocation = opts.failure.reason === 'location' && !!opts.onChangeLocation
  const pressed = await opts.notice({
    title: opts.title,
    message: opts.failure.message || opts.t('errors.cannotAddDetail'),
    ...(canChangeLocation ? { actionLabel: opts.t('errors.changeLocation') } : {})
  })
  if (pressed && canChangeLocation) await opts.onChangeLocation!()
}
