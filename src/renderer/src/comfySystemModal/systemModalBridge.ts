export type SystemModalConfirmStyle = 'primary' | 'danger'
export type SystemModalSecondaryStyle = 'primary' | 'danger' | 'default'
export type SystemModalAction = 'confirm' | 'cancel' | 'secondary'

export interface SystemModalDetailGroup {
  label: string
  items: string[]
}

export interface SystemModalSpec {
  id: string
  title: string
  message: string
  details?: SystemModalDetailGroup[]
  confirmLabel: string
  cancelLabel: string
  confirmStyle?: SystemModalConfirmStyle
  secondaryLabel?: string
  secondaryStyle?: SystemModalSecondaryStyle
  theme: { bg: string; text: string }
}

export interface SystemModalBridge {
  action(payload: { modalId: string; action: SystemModalAction }): void
  ready(): void
  notifyRendered(): void
  notifyRenderFailed(): void
  onModal(cb: (spec: SystemModalSpec) => void): () => void
}

export function systemModalBridge(): SystemModalBridge | undefined {
  return (window as unknown as { __comfySystemModal?: SystemModalBridge }).__comfySystemModal
}
