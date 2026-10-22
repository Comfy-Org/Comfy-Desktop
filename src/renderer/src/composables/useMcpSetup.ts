import { computed, onMounted, onUnmounted, type ComputedRef } from 'vue'
import type { PanelModalState } from './usePanelModal'

interface UseMcpSetupApi {
  /** True while the MCP setup modal is open. */
  mcpSetupOpen: ComputedRef<boolean>
  /** Asks main to close the modal; it closes once main has hidden the panel. */
  closeMcpSetup: () => void
}

/** ComfyUI's MCP sidebar entry → main forwards `onOpenMcpSetup` here. */
export function useMcpSetup(panelModal: PanelModalState): UseMcpSetupApi {
  let unsubOpen: (() => void) | null = null

  onMounted(() => {
    unsubOpen = window.api.onOpenMcpSetup(() => panelModal.open('mcp-setup'))
  })

  onUnmounted(() => {
    unsubOpen?.()
  })

  return {
    mcpSetupOpen: computed(() => panelModal.current.value === 'mcp-setup'),
    closeMcpSetup: () => panelModal.requestClose('mcp-setup')
  }
}
