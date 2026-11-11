import { watch, type Ref } from 'vue'

export interface InlineTextEditOptions {
  value: () => string
  commit: (next: string) => Promise<boolean>
  accepts?: (next: string) => boolean
}

export interface InlineTextEdit {
  focus: () => void
  onKeydown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void
  onBlur: () => Promise<void>
}

function selectContents(el: HTMLElement, collapseToEnd: boolean): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  if (collapseToEnd) range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function isSelectAll(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a'
}

export function useInlineTextEdit(
  el: Readonly<Ref<HTMLElement | null>>,
  options: InlineTextEditOptions
): InlineTextEdit {
  function isEditing(): boolean {
    return !!el.value && document.activeElement === el.value
  }

  function sync(): void {
    const node = el.value
    if (!node) return
    const value = options.value()
    if (node.textContent !== value) node.textContent = value
  }

  watch(
    [options.value, el],
    () => {
      if (!isEditing()) sync()
    },
    { immediate: true, flush: 'post' }
  )

  function focus(): void {
    const node = el.value
    if (!node) return
    node.focus()
    selectContents(node, true)
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return
    const node = el.value
    if (!node) return
    if (event.key === 'Enter') {
      event.preventDefault()
      node.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      sync()
      node.blur()
    } else if (isSelectAll(event)) {
      event.preventDefault()
      selectContents(node, false)
    }
  }

  function onPaste(event: ClipboardEvent): void {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '))
  }

  async function onBlur(): Promise<void> {
    const node = el.value
    if (!node || !document.hasFocus()) return
    const next = node.textContent?.trim() ?? ''
    if (!next || next === options.value() || options.accepts?.(next) === false) {
      sync()
      return
    }
    if (node.textContent !== next) node.textContent = next
    const committed = await options.commit(next)
    if (!committed && !isEditing()) sync()
  }

  return { focus, onKeydown, onPaste, onBlur }
}
