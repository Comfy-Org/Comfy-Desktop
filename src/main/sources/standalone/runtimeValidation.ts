import { t } from '../../lib/i18n'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Validate fresh standalone installs before persisting or allocating a directory.
 * Tracked/adopted installs use separate entry points and need no download. */
export function getStandaloneRuntimeError(data: Record<string, unknown>): string | null {
  const files = data.downloadFiles
  // Match install(): a non-empty file list takes precedence over the legacy URL.
  const hasDownload =
    Array.isArray(files) && files.length > 0
      ? files.every((file: unknown) => {
          if (!file || typeof file !== 'object') return false
          return (
            'url' in file &&
            isNonEmptyString(file.url) &&
            'filename' in file &&
            isNonEmptyString(file.filename)
          )
        })
      : (files === undefined || (Array.isArray(files) && files.length === 0)) &&
        isNonEmptyString(data.downloadUrl)
  return ['version', 'releaseTag', 'variant', 'pythonVersion'].every((key) =>
    isNonEmptyString(data[key])
  ) && hasDownload
    ? null
    : t('standalone.invalidRuntime')
}
