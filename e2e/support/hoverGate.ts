/**
 * Hover-gate helpers for the title-bar e2e tests. Title-bar `:hover` styles
 * are gated on `.is-hover-active`, dropped on blur/pointerleave and re-enabled
 * only on a fresh pointermove (not bare focus, to avoid a stale cursor pos).
 * These handlers only set/clear gate state, so repeating their events is safe.
 */
import { expect } from '@playwright/test'
import type { WebContentsPage } from './cdpPages'

export async function isHoverActive(titleBar: WebContentsPage): Promise<boolean> {
  return titleBar.evaluate<boolean>(
    `!!document.querySelector('.title-bar')?.classList.contains('is-hover-active')`,
    { readOnly: true },
  )
}

export async function waitForHoverActive(titleBar: WebContentsPage, expected: boolean): Promise<void> {
  await expect.poll(() => isHoverActive(titleBar), {
    timeout: 5_000,
    intervals: [50, 100, 200],
  }).toBe(expected)
}

export async function dispatchPointerMove(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 18 }))
  })()`, { idempotent: true })
}

export async function dispatchPointerLeave(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
  })()`, { idempotent: true })
}

export async function dispatchWindowBlur(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new FocusEvent('blur'))
  })()`, { idempotent: true })
}

export async function dispatchWindowFocus(titleBar: WebContentsPage): Promise<void> {
  await titleBar.evaluate<void>(`(() => {
    window.dispatchEvent(new FocusEvent('focus'))
  })()`, { idempotent: true })
}
