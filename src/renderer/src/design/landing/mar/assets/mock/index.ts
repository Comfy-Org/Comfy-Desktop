import { thumbSource } from '../../../mock'

/**
 * Mar's mock pictures: one per slot, so no picture shows twice in the
 * proposal (design-shots/media-audit.md lists where each one appears).
 * A file's name is its slot: `hero-explore.webp` is the Explore page's
 * header, `hero-shot-v4.webp` the workflow hero-shot-v4.json. Mock data
 * names its slot after the template id (`image_flux2~flux-portraits`);
 * Anything else keeps the template's thumbnail.
 */
const files = import.meta.glob<string>('./*.{webp,jpg}', { eager: true, import: 'default' })

export const MOCK: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.replace(/^\.\/|\.(webp|jpg)$/g, ''), url])
)

/** A slot's picture; missing slots fail loudly in development. */
export function mock(slot: string): string {
  const url = MOCK[slot]
  if (!url && import.meta.env.DEV) console.warn(`mar/assets/mock: no picture for "${slot}"`)
  return url ?? ''
}

/**
 * Template thumbnails, bundled from Comfy-Org/workflow_templates so the
 * proposal shows them offline (the published preview blocks remote images).
 * Missing ids fall back to the remote URL.
 */
const templateFiles = import.meta.glob<string>('../templates/*.webp', {
  eager: true,
  import: 'default'
})
const TEMPLATE_THUMBS: Record<string, string> = Object.fromEntries(
  Object.entries(templateFiles).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url])
)

thumbSource.pick = (id) => {
  const [template, slot] = id.split('~')
  return (slot && MOCK[slot]) || TEMPLATE_THUMBS[template!]
}

/** Project covers, in PROJECTS order (sidebar and Projects page). */
export const PROJECT_ART = [
  'project-hero-shots',
  'project-my-first-project',
  'project-flux-tests',
  'project-product-campaign',
  'project-explorations'
].map(mock)
