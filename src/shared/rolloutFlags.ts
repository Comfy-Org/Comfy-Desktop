/**
 * Rollout flags main passes to renderers in their URL query, so the first
 * paint already shows the right surface (no async settings read). Main reads
 * the settings (`isRolloutEnabled`); renderers read the query.
 */
export const ROLLOUT_QUERY_PARAM = {
  newDashboard: 'newDashboard',
  breadcrumb: 'breadcrumb'
} as const

export type RolloutFlags = Record<keyof typeof ROLLOUT_QUERY_PARAM, boolean>

export function readRolloutFlags(search: string): RolloutFlags {
  const query = new URLSearchParams(search)
  return {
    newDashboard: query.get(ROLLOUT_QUERY_PARAM.newDashboard) === 'true',
    breadcrumb: query.get(ROLLOUT_QUERY_PARAM.breadcrumb) === 'true'
  }
}
