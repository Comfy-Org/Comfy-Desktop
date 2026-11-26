import { net } from 'electron'
import { isEditorWorkflow, MAX_WORKFLOW_BYTES } from '../apps/openRequest'

const GRAPH_TIMEOUT_MS = 8000
const GRAPH_CACHE_LIMIT = 16

const graphs = new Map<string, Promise<Record<string, unknown>>>()

async function downloadEditorGraph(url: string): Promise<Record<string, unknown>> {
  const response = await net.fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
  })
  if (!response.ok || !response.body) throw new Error('Workflow download failed')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_WORKFLOW_BYTES) throw new Error('Workflow is too large')
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const graph: unknown = JSON.parse(text + decoder.decode())
  if (!isEditorWorkflow(graph)) throw new Error('Invalid editor workflow')
  return graph
}

export function fetchEditorGraph(url: string): Promise<Record<string, unknown>> {
  const known = graphs.get(url)
  if (known) return known
  const graph = downloadEditorGraph(url)
  graphs.set(url, graph)
  graph.catch(() => graphs.delete(url))
  while (graphs.size > GRAPH_CACHE_LIMIT) graphs.delete(graphs.keys().next().value as string)
  return graph
}

export function _forgetEditorGraphsForTest(): void {
  graphs.clear()
}
