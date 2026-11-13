import { reactive } from 'vue'

/** Share link (mar/shareLink.ts): where the assets on screen are, the
 *  asset open full screen and its build. Each view keeps it current while
 *  it's on screen; a link sets it before the view opens, and the view
 *  opens that asset.
 *  - desktop: Desktop's Assets page (?page=assets)
 *  - tab: ComfyUI's Assets, expanded to a tab (?comfy=tab)
 *  - panel: ComfyUI's Media Assets panel (?comfy=assets) */
export type AssetsAt = '' | 'desktop' | 'tab' | 'panel'
export const assetLink = reactive<{ at: AssetsAt; id: string; build: string }>({
  at: '',
  id: '',
  build: ''
})

/** A view takes the link over while it's on screen... */
export function holdAssetLink(at: AssetsAt, id: string, build = ''): void {
  Object.assign(assetLink, { at, id, build })
}
/** ...and lets it go when it closes, unless another view has it now. */
export function dropAssetLink(at: AssetsAt): void {
  if (assetLink.at === at) Object.assign(assetLink, { at: '', id: '', build: '' })
}
/** The asset a link asked this view to open, once. */
export function linkedAsset(at: AssetsAt): string {
  if (assetLink.at !== at || !assetLink.id) return ''
  return assetLink.id
}
