import { normalizeOpaqueIdentifier, normalizePostHogUserId } from './opaqueIdentifier'

export const PROACTIVE_GREETING_FLAG = 'agent-proactive-greeting-v1'
const PREFIX = 'proactive_greeting_'
const VARIANTS = new Set(['control', 'generic', 'canvas-prefill', 'canvas-only'])

export interface ProactiveGreetingAttribution {
  userId: string
  workspaceId: string
  groupKey: string
  variant: string
}

/** undefined is unrelated telemetry; null is a malformed experiment event. */
export function parseProactiveGreetingAttribution(
  event: string,
  properties: Record<string, unknown>
): ProactiveGreetingAttribution | null | undefined {
  const marked = Object.keys(properties).some((key) => key.startsWith(PREFIX))
  const ownExposure =
    event === '$experiment_exposure' && properties.$feature_flag === PROACTIVE_GREETING_FLAG
  if (!marked && !ownExposure) return undefined
  if (event !== '$experiment_exposure' && event !== 'app:agent_message_sent') return null
  const userId = normalizePostHogUserId(properties.proactive_greeting_user_id)
  const workspaceId = normalizeOpaqueIdentifier(properties.proactive_greeting_workspace_id, 256)
  const groupKey = properties.proactive_greeting_group_key
  const variant = properties.proactive_greeting_variant
  if (
    !userId ||
    userId !== properties.proactive_greeting_user_id ||
    !workspaceId ||
    workspaceId !== properties.proactive_greeting_workspace_id ||
    typeof groupKey !== 'string' ||
    groupKey !== JSON.stringify([userId, workspaceId]) ||
    typeof variant !== 'string' ||
    !VARIANTS.has(variant)
  )
    return null
  if (
    event === '$experiment_exposure' &&
    properties.canvas_state !== 'empty' &&
    properties.canvas_state !== 'workflow'
  )
    return null
  return { userId, workspaceId, groupKey, variant }
}

/** Construct reserved PostHog properties only after validating the originating actor. */
export function proactiveGreetingProperties(attribution: ProactiveGreetingAttribution) {
  return {
    distinct_id: attribution.userId,
    $user_id: attribution.userId,
    user_id: attribution.userId,
    workspace_id: attribution.workspaceId,
    $groups: { user_workspace: attribution.groupKey },
    [`$feature/${PROACTIVE_GREETING_FLAG}`]: attribution.variant
  }
}
