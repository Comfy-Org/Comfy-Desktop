/** Modals shown over the window body without changing its page. */
export type PanelModal = 'announcement' | 'feedback' | 'mcp-setup'

const PANEL_MODALS: ReadonlySet<PanelModal> = new Set<PanelModal>([
  'announcement',
  'feedback',
  'mcp-setup'
])

export function isPanelModal(raw: unknown): raw is PanelModal {
  return typeof raw === 'string' && PANEL_MODALS.has(raw as PanelModal)
}
