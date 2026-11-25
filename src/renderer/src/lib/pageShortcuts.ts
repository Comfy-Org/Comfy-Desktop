export function shortcutBelongsToOverlay(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  return (
    Boolean(target?.closest('[role="dialog"], [role="alertdialog"]')) ||
    document.querySelector('[aria-modal="true"]') !== null
  )
}
