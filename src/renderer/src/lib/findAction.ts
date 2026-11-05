import type { ActionDef, DetailFieldOption, DetailSection } from '../types/ipc'

export function findActionById(
  sections: DetailSection[],
  actionId: string,
  currentChannelValue?: string | null
): ActionDef | null {
  for (const section of sections) {
    const match = section.actions?.find((a) => a.id === actionId)
    if (match) return match
  }

  let firstMatch: ActionDef | null = null
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      for (const option of (field.options ?? []) as DetailFieldOption[]) {
        const nestedActions = (option.data?.actions ?? []) as ActionDef[]
        const match = nestedActions.find((a) => a?.id === actionId)
        if (!match) continue
        if (currentChannelValue != null && option.value === currentChannelValue) {
          return match
        }
        if (!firstMatch) firstMatch = match
      }
    }
  }
  return firstMatch
}
