// Mar's living design system: the real prototype components, in the
// default view. The About page (pages/AboutPage.vue) says
// what it covers and how it is built.
//
// The prototype keeps its knobs (UI Playground, theme) in
// localStorage, shared with every prototype tab. This page swaps in an
// in-memory store first, so it always shows the defaults and never
// changes what Mar's open prototype shows. Only `mar-ds.*` keys (this
// page's own view settings) reach the real storage.
const real = window.localStorage
const memory = new Map<string, string>()
const own = (k: string): boolean => k.startsWith('mar-ds.')
const store: Storage = {
  getItem: (k) => (own(k) ? real.getItem(k) : (memory.get(k) ?? null)),
  setItem: (k, v) => (own(k) ? real.setItem(k, v) : void memory.set(k, String(v))),
  removeItem: (k) => (own(k) ? real.removeItem(k) : void memory.delete(k)),
  clear: () => memory.clear(),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size
  }
}
Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store })

// Imported after the swap: module imports are hoisted, a dynamic one is not.
void import('./boot')
