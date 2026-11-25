import { reactive } from 'vue'

/**
 * Builds that didn't start, and why (prototype data). One place, so the
 * Builds page, the sidebar and the build's own page agree: each shows the
 * attention icon while a build is here, and Try again clears it.
 */
export const BUILD_ERRORS = reactive<Record<string, string>>({
  'local-flux': 'A custom node didn’t load. See the logs.'
})

export const errorOf = (id: string): string | undefined => BUILD_ERRORS[id]

export function clearError(id: string): void {
  delete BUILD_ERRORS[id]
}
