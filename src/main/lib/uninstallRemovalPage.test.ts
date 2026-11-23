import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

type Control = { kind: string; y: number; height: number; text: string }

function removalChoicesPage(): Control[] {
  const installerPath = path.resolve(__dirname, '../../../scripts/installer.nsh')
  const source = fs.readFileSync(installerPath, 'utf-8')
  const start = source.indexOf('Function un.ComfyRemovalChoicesPage\n')
  const end = source.indexOf('FunctionEnd', start)
  if (start < 0 || end < 0) throw new Error('un.ComfyRemovalChoicesPage not found in installer.nsh')
  const pattern = /\$\{NSD_Create(Checkbox|Label)\} \S+ (\d+)u? \S+ (\d+)u "([^"]*)"/g
  return [...source.slice(start, end).matchAll(pattern)].map((match) => ({
    kind: match[1] ?? '',
    y: Number(match[2]),
    height: Number(match[3]),
    text: match[4] ?? ''
  }))
}

function options(controls: Control[]): { checkbox: Control; description: Control }[] {
  return controls.flatMap((control, index) => {
    const next = controls[index + 1]
    return control.kind === 'Checkbox' && next?.kind === 'Label'
      ? [{ checkbox: control, description: next }]
      : []
  })
}

describe('uninstaller removal choices page', () => {
  it('calls a ComfyUI install a build in every line it shows', () => {
    const controls = removalChoicesPage()
    expect(controls[0]?.text).toBe('Delete all ComfyUI builds')
    for (const control of controls) {
      expect(control.text).not.toMatch(/\binstances?\b/i)
      expect(control.text).not.toMatch(/\binstall(s|'s)?\b/i)
    }
  })

  it('leaves the same gap under each option before the next one', () => {
    const page = options(removalChoicesPage())
    expect(page).toHaveLength(3)
    expect(new Set(page.map((option) => option.description.height)).size).toBe(1)
    const gaps = page.slice(1).map((option, index) => {
      const above = page[index]?.description
      return above ? option.checkbox.y - (above.y + above.height) : NaN
    })
    expect(new Set(gaps).size).toBe(1)
  })
})
