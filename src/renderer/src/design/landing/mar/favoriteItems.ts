import { computed } from 'vue'
import { APPS, thumb } from '../mock'
import { allAssets } from '../gallery'
import { openApp } from '../appFlow'
import { openDetail, toast } from '../useProto'
import { tplById } from './templateModal/templateData'
import { hubThumb } from './explore/hubWorkflows'
import { favorites, type FavoriteKind } from './favorites'

/** What a starred key points at, for the sidebar and the Favorites page. */
export interface FavoriteItem {
  key: string
  kind: FavoriteKind
  id: string
  title: string
  src?: string
  open: () => void
}

function resolve(key: string): FavoriteItem | undefined {
  const [kind, ...rest] = key.split(':') as [FavoriteKind, ...string[]]
  const id = rest.join(':')
  if (kind === 'template') {
    // The Hub's workflows first (real names), then the mock's.
    const t = tplById(id)
    return (
      t && {
        key,
        kind,
        id,
        title: t.title,
        src: hubThumb(t.id) ?? thumb(t.id),
        open: () => openDetail('template', t.id)
      }
    )
  }
  if (kind === 'app') {
    const a = APPS.find((x) => x.id === id)
    return (
      a && {
        key,
        kind,
        id,
        title: a.name,
        src: thumb(a.thumbId),
        open: () => openApp(a.id)
      }
    )
  }
  const a = allAssets.value.find((x) => x.id === id)
  return (
    a && {
      key,
      kind,
      id,
      title: a.name,
      src: a.thumbId ? thumb(a.thumbId) : undefined,
      open: () => toast(`Open ${a.name}`)
    }
  )
}

/** Everything starred, newest first; anything that no longer exists drops out. */
export const favoriteItems = computed(() =>
  [...favorites.keys]
    .reverse()
    .map(resolve)
    .filter((i) => i !== undefined)
)
