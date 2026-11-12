interface ViewStack<V> {
  readonly children: V[]
  addChildView(view: V, index?: number): void
}

export function stackApps<V>(content: ViewStack<V>, view: V, panel: V, parked: boolean): boolean {
  if (!parked) {
    content.addChildView(view)
    return true
  }
  const below = content.children.indexOf(panel)
  if (below === -1) return false
  const at = content.children.indexOf(view)
  if (at === -1 || at > below) content.addChildView(view, below)
  return true
}
