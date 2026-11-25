/**
 * Download: the browser saves the file, as its own download does. No
 * toast; the browser already shows it.
 */
export function saveFile(src: string | undefined, name: string): void {
  if (!src) return
  const a = document.createElement('a')
  a.href = src
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}
