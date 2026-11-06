import { onBeforeUnmount, onMounted } from 'vue'
import { proto, toggleHome } from './useProto'
import { can, MILESTONES } from './milestones'
import { marUser, setUser } from './mar/userStates/userState'

/** The prototype's shortcuts: ⌥1-⌥0 milestone (the first ten) · ⌥N new user ·
 *  ⌘⇧H home ⇄ build (from One window). */
export function usePrototypeShortcuts(): void {
  function onKey(e: KeyboardEvent): void {
    // ⌘⇧H: Home ⇄ the build you were in.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyH' && can.value.oneWindow) {
      e.preventDefault()
      toggleHome()
      return
    }
    if (!e.altKey) return
    const digit = /^Digit(\d)$/.exec(e.code)?.[1]
    // ⌥1 is the first milestone in the menu, … ⌥0 the tenth.
    if (digit) proto.milestone = Number(MILESTONES[(Number(digit) + 9) % 10]!.value)
    else if (e.code === 'KeyN' && can.value.home)
      setUser(marUser.user === 'first' ? 'returning' : 'first')
    else return
    e.preventDefault()
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
