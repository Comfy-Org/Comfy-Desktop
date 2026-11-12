import type { TemplateSearchResult } from '../../types/ipc'

export interface TemplateSearchBackend {
  search(query: string): Promise<TemplateSearchResult>
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
