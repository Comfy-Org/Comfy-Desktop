import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { applyFirstUseModeFromPanel } from './firstUseModeRouting'
import type { ComfyWindowEntry } from './registry'

function windowEntry() {
  const panel = {} as WebContents
  const send = vi.fn()
  const entry = {
    panelView: { webContents: panel },
    titleBarView: { webContents: { isDestroyed: () => false, send } },
    firstUseMode: 'none'
  } as unknown as ComfyWindowEntry
  return { entry, panel, send }
}

describe('applyFirstUseModeFromPanel', () => {
  it("applies the mode to the sender's window even when it is not the first", () => {
    const first = windowEntry()
    const second = windowEntry()
    applyFirstUseModeFromPanel([first.entry, second.entry], second.panel, 'consent-lockdown')
    expect(second.entry.firstUseMode).toBe('consent-lockdown')
    expect(second.send).toHaveBeenCalledWith(
      'comfy-titlebar:first-use-mode-changed',
      'consent-lockdown'
    )
  })

  it('leaves every other window alone', () => {
    const first = windowEntry()
    const second = windowEntry()
    applyFirstUseModeFromPanel([first.entry, second.entry], second.panel, 'post-consent')
    expect(first.entry.firstUseMode).toBe('none')
    expect(first.send).not.toHaveBeenCalled()
  })
})
