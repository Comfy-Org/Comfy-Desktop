import type { TemplateSearchCandidate, TemplateSearchResult } from '../../types/ipc'

export type SearchRowKind = 'run' | 'download' | 'more' | 'also'

const WEAK_MATCH_FLOOR = 0.05
const STRONG_MATCH = 0.85

export type MatchLevel = 'strong' | 'good' | 'weak'

export type BadgeTone = 'partner' | 'best' | 'download' | 'input' | MatchLevel

export interface SearchRow {
  key: string
  kind: SearchRowKind
  candidate: TemplateSearchCandidate
  best: boolean
  familyPick: boolean
}

function matchValue(candidate: TemplateSearchCandidate): number | null {
  return candidate.calibrated ?? candidate.score
}

export function matchLevel(candidate: TemplateSearchCandidate): MatchLevel | null {
  const value = matchValue(candidate)
  if (value === null) return null
  if (candidate.belowThreshold) return 'weak'
  return value >= STRONG_MATCH ? 'strong' : 'good'
}

function shown(candidate: TemplateSearchCandidate): boolean {
  return !candidate.belowThreshold || (matchValue(candidate) ?? 0) >= WEAK_MATCH_FLOOR
}

function rowsOf(kind: SearchRowKind, candidates: TemplateSearchCandidate[]): SearchRow[] {
  return candidates.filter(shown).map((candidate) => ({
    key: `${kind}:${candidate.templateId}`,
    kind,
    candidate,
    best: false,
    familyPick: true
  }))
}

interface CardBox {
  left: number
  top: number
  width: number
}

function centre(box: CardBox): number {
  return box.left + box.width / 2
}

export function verticalNeighbour(boxes: CardBox[], active: number, step: 1 | -1): number | null {
  const from = boxes[active]
  if (!from) return null
  const tops = [...new Set(boxes.map((box) => Math.round(box.top)))].sort((a, b) => a - b)
  const row = tops.indexOf(Math.round(from.top))
  const target = tops[(row + step + tops.length) % tops.length]
  let nearest: number | null = null
  let nearestDistance = Infinity
  for (const [index, box] of boxes.entries()) {
    const distance = Math.abs(centre(box) - centre(from))
    if (Math.round(box.top) !== target || distance >= nearestDistance) continue
    nearest = index
    nearestDistance = distance
  }
  return nearest
}

function familiesTogether(cards: SearchRow[]): SearchRow[] {
  const pending = [...cards]
  const rows: SearchRow[] = []
  while (pending.length > 0) {
    const pick = pending.shift()!
    rows.push(pick)
    const family = pick.candidate.family
    if (family === null) continue
    const sameFamily = pending.filter((other) => other.candidate.family === family)
    rows.push(...sameFamily.map((row) => ({ ...row, familyPick: false })))
    for (const other of sameFamily) pending.splice(pending.indexOf(other), 1)
  }
  return rows
}

export function searchRows(result: TemplateSearchResult): SearchRow[] {
  if (result.outcome === 'bad_input') return []
  const run = rowsOf('run', result.run)
  const download = rowsOf('download', result.download)
  const lead =
    result.outcome === 'template' ? run[0] : result.outcome === 'download' ? download[0] : null
  if (lead && !result.matched) lead.best = true
  const cards = [...run, ...download, ...rowsOf('more', result.more)]
  const leadFirst = lead ? [lead, ...cards.filter((row) => row !== lead)] : cards
  return [...familiesTogether(leadFirst), ...rowsOf('also', result.alsoTry)]
}
