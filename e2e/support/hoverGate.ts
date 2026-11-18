import { expect } from '@playwright/test'
import type { WebContentsPage } from './cdpPages'

export async function isHoverActive(titleBar: WebContentsPage): Promise<boolean> {
  return titleBar.evaluate<boolean>(
    `!!document.querySelector('.title-bar')?.classList.contains('is-hover-active')`
  )
}

export async function waitForHoverActive(
  titleBar: WebContentsPage,
  expected: boolean
): Promise<void> {
  await expect
    .poll(() => isHoverActive(titleBar), {
      timeout: 5_000,
      intervals: [50, 100, 200]
    })
    .toBe(expected)
}

export async function dispatchPointerMove(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 18 }))
  })()`)
}

export async function dispatchPointerLeave(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
  })()`)
}

export async function dispatchWindowBlur(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new FocusEvent('blur'))
  })()`)
}

export async function dispatchWindowFocus(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new FocusEvent('focus'))
  })()`)
}
