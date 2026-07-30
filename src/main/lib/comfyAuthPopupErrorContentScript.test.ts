/// <reference lib="dom" />
import { afterEach, describe, expect, it } from 'vitest'
import { getComfyAuthPopupErrorContentScript } from './comfyAuthPopupErrorContentScript'

type SuppressorWindow = Window & {
  __comfyDesktopAuthPopupErrorSuppressor?: MutationObserver
}

describe('getComfyAuthPopupErrorContentScript', () => {
  const script = getComfyAuthPopupErrorContentScript()
  const suppressorWindow = window as SuppressorWindow

  afterEach(() => {
    suppressorWindow.__comfyDesktopAuthPopupErrorSuppressor?.disconnect()
    delete suppressorWindow.__comfyDesktopAuthPopupErrorSuppressor
    document.body.innerHTML = ''
  })

  function installSuppressor(): void {
    new Function(script)()
  }

  function flushObserver(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('returns a syntactically valid, self-contained IIFE', () => {
    expect(script.startsWith('(function(){')).toBe(true)
    expect(() => new Function(script)).not.toThrow()
  })

  it('removes popup-blocked and mapped sign-in errors but preserves unrelated toasts', async () => {
    installSuppressor()

    const rawError = document.createElement('div')
    rawError.setAttribute('role', 'alert')
    rawError.textContent = 'Firebase: Error (auth/popup-blocked).'

    const mappedError = document.createElement('div')
    mappedError.className = 'p-toast-message'
    mappedError.textContent = 'Something went wrong while signing you in. Please try again.'

    const unrelatedError = document.createElement('div')
    unrelatedError.setAttribute('role', 'alert')
    unrelatedError.textContent = 'Failed to download the selected model.'

    document.body.append(rawError, mappedError, unrelatedError)
    await flushObserver()

    expect(rawError.isConnected).toBe(false)
    expect(mappedError.isConnected).toBe(false)
    expect(unrelatedError.isConnected).toBe(true)
  })

  it('does not install duplicate observers on the same page', () => {
    installSuppressor()
    const firstObserver = suppressorWindow.__comfyDesktopAuthPopupErrorSuppressor

    installSuppressor()

    expect(suppressorWindow.__comfyDesktopAuthPopupErrorSuppressor).toBe(firstObserver)
  })
})
