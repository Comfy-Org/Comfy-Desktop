export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function formatBytesCoarse(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1073741824) return `${Math.round(bytes / 1048576)} MB`
  return `${Math.round(bytes / 1073741824)} GB`
}

export function formatFreeSpace(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  const gb = Math.round(bytes / 1073741824)
  if (gb >= 1000) return `${(bytes / 1099511627776).toFixed(1)} TB`
  if (gb >= 1) return `${gb} GB`
  return formatBytesCoarse(bytes)
}
