import { reactive } from 'vue'

/** Share link (mar/shareLink.ts): the asset open full screen in Assets,
 *  and the build it's in. Assets keeps it current while it's on screen;
 *  a link sets it before the page opens, and the page opens that asset. */
export const assetLink = reactive({ id: '', build: '' })
