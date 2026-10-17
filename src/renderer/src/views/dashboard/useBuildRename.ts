import { inject, provide, ref } from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from '../../composables/useModal'
import type { Installation } from '../../types/ipc'

/** Where a rename happens: the sidebar's row, or the card or page title. */
export type RenameSurface = 'sidebar' | 'main'

/** The Comfy Cloud build's name is fixed (main ignores a new one). */
const CLOUD_SOURCE_ID = 'cloud'

function createBuildRename() {
  const { t } = useI18n()
  const modal = useModal()
  const renaming = ref<{ id: string; surface: RenameSurface } | null>(null)

  function canRename(inst: Installation): boolean {
    return inst.sourceId !== CLOUD_SOURCE_ID
  }

  function startRename(inst: Installation, surface: RenameSurface): void {
    if (canRename(inst)) renaming.value = { id: inst.id, surface }
  }

  function isRenaming(inst: Installation, surface: RenameSurface): boolean {
    return renaming.value?.id === inst.id && renaming.value.surface === surface
  }

  function cancelRename(): void {
    renaming.value = null
  }

  async function commitRename(inst: Installation, name: string): Promise<void> {
    renaming.value = null
    try {
      const result = await window.api.updateInstallation(inst.id, { name })
      if (result?.ok === false) throw new Error(result.message ?? '')
    } catch (err) {
      await modal.alert({
        title: t('buildsDashboard.rename.failed'),
        message: (err as Error).message
      })
    }
  }

  return { canRename, startRename, isRenaming, cancelRename, commitRename }
}

type BuildRename = ReturnType<typeof createBuildRename>
const BUILD_RENAME: InjectionKey<BuildRename> = Symbol('buildRename')

/**
 * Renaming a build in place, for the whole dashboard: one build at a time, on
 * the surface it was started from (double-click, or Rename in its menu).
 * Main rejects a name another build already has; the reason is shown and the
 * old name stays.
 */
export function provideBuildRename(): BuildRename {
  const rename = createBuildRename()
  provide(BUILD_RENAME, rename)
  return rename
}

export function injectBuildRename(): BuildRename {
  const rename = inject(BUILD_RENAME)
  if (!rename) throw new Error('injectBuildRename() needs provideBuildRename() above it')
  return rename
}
