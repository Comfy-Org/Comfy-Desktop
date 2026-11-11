interface ViewStack<V> {
  readonly children: V[]
  addChildView(view: V, index?: number): void
}

export function stackApps<V>(content: ViewStack<V>, view: V, panel: V, parked: boolean): void {
  const below = content.children.indexOf(panel)
  if (!parked || below === -1) return content.addChildView(view)
  const at = content.children.indexOf(view)
  if (at === -1 || at > below) content.addChildView(view, below)
}
