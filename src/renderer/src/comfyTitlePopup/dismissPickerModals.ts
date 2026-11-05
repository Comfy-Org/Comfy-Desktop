import { useDialogs } from '../composables/useDialogs'
import { useModal } from '../composables/useModal'

export function dismissPickerModals(): void {
  const modal = useModal()
  modal.dismiss()
  const dialogs = useDialogs()
  if (dialogs.state.open) dialogs.cancel()
}
