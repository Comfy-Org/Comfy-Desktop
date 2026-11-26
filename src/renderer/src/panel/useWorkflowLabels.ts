import { useI18n } from 'vue-i18n'
import type { CatalogWorkflowLicense } from '../types/ipc'
import { humanizeSlug } from './exploreWorkflows'

export function useWorkflowLabels() {
  const { t, te, n } = useI18n()

  function known(key: string, slug: string): string {
    return te(key) ? t(key) : humanizeSlug(slug)
  }

  return {
    useCase: (slug: string): string => known(`workflows.useCase.${slug}`, slug),
    generation: (slug: string): string => known(`workflows.generation.${slug}`, slug),
    license: (license: CatalogWorkflowLicense): string => t(`workflows.license.${license}`),
    count: (value: number): string => n(value)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
