import { reactive } from 'vue'

const keyOf = (templateId: string, instId: string): string => `${templateId}@${instId}`

const downloaded = reactive({ keys: [] as string[] })

export function markDownloaded(templateId: string, instId: string): void {
  const key = keyOf(templateId, instId)
  if (!downloaded.keys.includes(key)) downloaded.keys.push(key)
}

export const isDownloaded = (templateId: string, instId: string): boolean =>
  downloaded.keys.includes(keyOf(templateId, instId))

export function forgetDownloaded(templateId: string): void {
  downloaded.keys = downloaded.keys.filter((k) => !k.startsWith(`${templateId}@`))
}
