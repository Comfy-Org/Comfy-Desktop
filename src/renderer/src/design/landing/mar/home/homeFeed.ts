import type { Component } from 'vue'
import { Play } from 'lucide-vue-next'
import { ARC_TEMPLATES, arcApps, type ArcItem } from '../userStates/arcItems'
import { PROD_APPS, PROD_EXAMPLES, PROD_HOOKS, prodApp, prodClip, prodId } from '../apps/prodApps'
import { openAppPage } from '../../appFlow'
import { HUB_WORKFLOWS } from '../explore/hubWorkflows'
import { exploreStart } from '../explore/exploreStart'
import { LAUNCHES, TUTORIALS, thumb } from '../../mock'
import { go, toast } from '../../useProto'
import { can } from '../../milestones'

export type FeedTab = 'new' | 'apps' | 'workflows' | 'learn'
export type FeedKind = 'apps' | 'workflows'

export interface FeedItem {
  id: string
  title: string
  line: string
  right?: string
  length?: { label: string; icon: Component }
  src?: string
  clip?: string
  open: () => void
  usage?: number
  date?: string
  ratio?: number
}

const CLIPS: Record<string, string> = Object.fromEntries(
  PROD_APPS.map((p) => [prodId(p.slug), prodClip(p.slug)])
)

const fromArc = (x: ArcItem): FeedItem => ({
  id: x.id,
  title: x.label,
  line: PROD_HOOKS[x.id] ?? x.does,
  src: x.src,
  clip: CLIPS[x.id] || undefined,
  open: x.open
})

export const feedApps = (): FeedItem[] => arcApps().map(fromArc)

const hub = (id: string): (typeof HUB_WORKFLOWS)[number] | undefined =>
  HUB_WORKFLOWS.find((h) => h.id === id)

export const feedWorkflows = (): FeedItem[] =>
  ARC_TEMPLATES.map((x) => {
    const w = hub(x.id)
    return { ...fromArc(x), usage: w?.usage, date: w?.date }
  })

export const newTemplates = (count: number): FeedItem[] =>
  [...feedWorkflows()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, count)

const feedNews = (): FeedItem[] =>
  LAUNCHES.map((l) => ({
    id: `launch-${l.title}`,
    title: l.title,
    line: l.kind === 'model' ? 'New model' : 'New feature',
    clip: l.video,
    open: () => toast(`Try ${l.title}`)
  }))

const feedLearn = (): FeedItem[] =>
  TUTORIALS.filter((t) => (t.progress ?? 0) < 1)
    .slice(0, 8)
    .map((t) => ({
      id: `learn-${t.title}`,
      title: t.title,
      line: t.blurb,
      length: { label: `${t.minutes} min`, icon: Play },
      src: thumb(t.thumbId),
      open: () => toast(`Watch: ${t.title}`)
    }))

export const FEED_TABS = (): { value: FeedTab; label: string }[] =>
  (
    [
      { value: 'new', label: "What's new", on: true },
      { value: 'workflows', label: 'Workflows', on: can.value.explore },
      { value: 'apps', label: 'Apps', on: true },
      { value: 'learn', label: 'Learn', on: can.value.learn }
    ] as const
  )
    .filter((t) => t.on)
    .map(({ value, label }) => ({ value, label }))

export function feed(tab: FeedTab): FeedItem[] {
  if (tab === 'new') return feedNews()
  if (tab === 'workflows') return feedWorkflows().slice(0, 8)
  if (tab === 'learn') return feedLearn()
  return feedApps()
}

export function exploreAll(tab: FeedTab | 'templates'): void {
  if (tab === 'new') return toast('All launches')
  if (tab === 'learn') return go('tutorials')
  exploreStart.value = tab === 'workflows' || tab === 'templates' ? 'templates' : 'apps'
  go('explore')
}

export function feedCatalog(kind: FeedKind): FeedItem[] {
  if (kind === 'apps') return can.value.onboarding ? appExamples() : feedApps()
  return feedWorkflows().map((x) => ({ ...x, line: hub(x.id)?.family ?? x.line }))
}

const ratioOf = (r: string | undefined): number | undefined => {
  if (!r) return undefined
  const [w, h] = r.split('/').map((n) => Number(n.trim()))
  return w && h ? w / h : undefined
}

function appExamples(): FeedItem[] {
  return PROD_EXAMPLES.map((x, i) => ({
    id: x.id,
    title: prodApp(x.app)?.title ?? x.title,
    line: x.title,
    src: x.after,
    ratio: ratioOf(x.ratio),
    usage: -i,
    open: () => openAppPage(x.app)
  }))
}
