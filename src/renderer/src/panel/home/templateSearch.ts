import type {
  TemplateSearchCandidate,
  TemplateSearchResponse,
  TemplateSearchResult
} from '../../types/ipc'

export type SearchRowKind = 'run' | 'download' | 'agent'

export interface TemplateSearchPick {
  query: string
  kind: Exclude<SearchRowKind, 'agent'>
  position: number
  best: boolean
}

export interface TemplateSearchClient {
  search(query: string): Promise<TemplateSearchResponse>
  open(candidate: TemplateSearchCandidate, pick: TemplateSearchPick): Promise<boolean>
}

export interface SearchRow {
  key: string
  kind: SearchRowKind
  candidate: TemplateSearchCandidate | null
  best: boolean
}

function templateRow(kind: 'run' | 'download', candidate: TemplateSearchCandidate): SearchRow {
  return { key: `${kind}:${candidate.templateId}`, kind, candidate, best: false }
}

export function searchRows(result: TemplateSearchResult): SearchRow[] {
  if (result.outcome === 'bad_input') return []
  const templates = [
    ...result.run.map((candidate) => templateRow('run', candidate)),
    ...result.download.map((candidate) => templateRow('download', candidate))
  ]
  const agent: SearchRow = { key: 'agent', kind: 'agent', candidate: null, best: false }
  if (result.outcome === 'agent') return [{ ...agent, best: true }, ...templates]
  const [first, ...rest] = templates
  if (result.outcome === 'template' && first) return [{ ...first, best: true }, ...rest, agent]
  return [...templates, agent]
}
