/** Copy is re-cut from the marketing site's `cloud.*` strings, which carry HTML
 *  and hard line breaks that vue-i18n would render literally. */

export type ShowcaseAction = 'cloud'

export interface ShowcaseCard {
  id: string
  title: string
  body: string
  /** Present only on the card that offers a way out of the wait. */
  action?: ShowcaseAction
}

export const SHOWCASE_CARDS: readonly ShowcaseCard[] = [
  {
    id: 'cloud',
    title: 'installShowcase.cloud.title',
    body: 'installShowcase.cloud.body',
    action: 'cloud'
  },
  { id: 'gpu', title: 'installShowcase.gpu.title', body: 'installShowcase.gpu.body' },
  { id: 'models', title: 'installShowcase.models.title', body: 'installShowcase.models.body' },
  { id: 'partner', title: 'installShowcase.partner.title', body: 'installShowcase.partner.body' },
  { id: 'license', title: 'installShowcase.license.title', body: 'installShowcase.license.body' },
  { id: 'nodes', title: 'installShowcase.nodes.title', body: 'installShowcase.nodes.body' },
  { id: 'loras', title: 'installShowcase.loras.title', body: 'installShowcase.loras.body' },
  { id: 'queue', title: 'installShowcase.queue.title', body: 'installShowcase.queue.body' },
  { id: 'idle', title: 'installShowcase.idle.title', body: 'installShowcase.idle.body' }
]
