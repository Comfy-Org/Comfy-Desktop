/** Title-bar modals shown over the window body without changing its page. */
export type PanelModal = 'announcement' | 'feedback'

const PANEL_MODALS: ReadonlySet<PanelModal> = new Set<PanelModal>(['announcement', 'feedback'])

export function isPanelModal(raw: unknown): raw is PanelModal {
  return typeof raw === 'string' && PANEL_MODALS.has(raw as PanelModal)
}
