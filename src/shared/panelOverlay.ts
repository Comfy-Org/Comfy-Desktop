export function isTransparentPanelOverlay(panel: string, backgroundPanel = panel): boolean {
  if (panel === 'announcement') {
    return ['comfy', 'feedback', 'mcp-setup'].includes(backgroundPanel)
  }
  return panel === 'feedback' || panel === 'mcp-setup'
}
