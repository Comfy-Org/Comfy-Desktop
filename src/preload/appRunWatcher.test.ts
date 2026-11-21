import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRunReporter, watchAppRun } from './appRunWatcher'

const toasts = document.createElement('div')
toasts.className = 'cs-toasts'

function showToast(): HTMLElement {
  const toast = document.createElement('div')
  toast.className = 'cs-toast'
  toasts.append(toast)
  return toast
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let stop: (() => void) | null = null

afterEach(() => {
  stop?.()
  stop = null
  toasts.replaceChildren()
  toasts.remove()
})

describe('watchAppRun', () => {
  it('reports a run while the page shows its progress toast, and its end once the toast goes', async () => {
    document.body.append(toasts)
    const report = vi.fn()
    stop = watchAppRun(document, report)

    const toast = showToast()
    await settle()
    expect(report).toHaveBeenLastCalledWith(true)

    toast.remove()
    await settle()
    expect(report).toHaveBeenLastCalledWith(false)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('reports a run that is already showing when the watch starts', () => {
    document.body.append(toasts)
    showToast()
    const report = vi.fn()

    stop = watchAppRun(document, report)

    expect(report).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('says nothing about toasts that change while the run goes on', async () => {
    document.body.append(toasts)
    const report = vi.fn()
    stop = watchAppRun(document, report)

    showToast()
    await settle()
    showToast()
    await settle()

    expect(report).toHaveBeenCalledExactlyOnceWith(true)
  })
})

describe('createRunReporter', () => {
  it('follows the toast until the page reports runs itself, then only its reports', async () => {
    document.body.append(toasts)
    const send = vi.fn()
    const reporter = createRunReporter(document, send)
    reporter.watchToast()
    const toast = showToast()
    await settle()
    expect(send).toHaveBeenLastCalledWith(true)

    reporter.reportRun({ running: false })
    toast.remove()
    showToast()
    await settle()

    expect(send.mock.calls).toEqual([[true], [false]])
  })

  it('never watches the toast once the page has reported a run', async () => {
    document.body.append(toasts)
    const send = vi.fn()
    const reporter = createRunReporter(document, send)

    reporter.reportRun({ running: true })
    reporter.watchToast()
    showToast()
    await settle()

    expect(send.mock.calls).toEqual([[true]])
  })

  it('counts anything but running true as no run', () => {
    const send = vi.fn()
    const reporter = createRunReporter(document, send)

    reporter.reportRun({ running: 'yes' })
    reporter.reportRun(null)

    expect(send.mock.calls).toEqual([[false], [false]])
  })
})
