import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInFailure } from '../main/cloud/signInFailure'
import type { ComfyDesktop2TerminalBridge } from '../types/comfyDesktopBridge'
import type { ElectronApi } from '../types/ipc'

const mainProcess = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  async function replyAsElectronMainDoes(
    channel: string,
    args: unknown[]
  ): Promise<{ result?: unknown; error?: string }> {
    try {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler registered for '${channel}'`)
      return { result: await handler(...args) }
    } catch (thrown) {
      return { error: String(thrown) }
    }
  }

  async function invokeAsElectronRendererDoes(
    channel: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const reply = await replyAsElectronMainDoes(channel, structuredClone(args))
    if (reply.error) throw new Error(`Error invoking remote method '${channel}': ${reply.error}`)
    return reply.result
  }

  return { handlers, invoke: invokeAsElectronRendererDoes }
})

const page = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, bridge: unknown) => page.exposed.set(name, bridge)
  },
  ipcRenderer: {
    invoke: mainProcess.invoke,
    on: vi.fn(),
    removeListener: page.removeListener,
    send: vi.fn()
  },
  webUtils: { getPathForFile: (file: { name: string }) => `/dropped/${file.name}` }
}))

import './index'
import './comfyTitlePopupPreload'
import './terminalPreload'
import type { ComfyTitlePopupBridge } from './comfyTitlePopupPreload'

function exposedToPage<Bridge>(name: string): Bridge {
  return (page.exposed.get(name) ?? (globalThis as Record<string, unknown>)[name]) as Bridge
}

const mainWindowApi = (): ElectronApi => exposedToPage<ElectronApi>('api')
const pickerPopup = (): ComfyTitlePopupBridge =>
  exposedToPage<ComfyTitlePopupBridge>('__comfyTitlePopup')
const terminalWindow = (): ComfyDesktop2TerminalBridge =>
  exposedToPage<ComfyDesktop2TerminalBridge>('__comfyDesktopTerminal')

function handlerThrows(channel: string, thrown: unknown): void {
  mainProcess.handlers.set(channel, () => {
    throw thrown
  })
}

function errorThrownBy(failingCall: () => unknown): Error {
  try {
    failingCall()
  } catch (thrown) {
    return thrown as Error
  }
  throw new Error('the call was expected to throw')
}

function messageThePageCatches(call: Promise<unknown>): Promise<string> {
  return call.then(
    () => {
      throw new Error('the call was expected to reject')
    },
    (rejection: Error) => rejection.message
  )
}

const ERRORS_A_HANDLER_THROWS: [string, () => Error][] = [
  ['an Error', () => new Error('Installation not found or has no install path')],
  [
    'a TypeError',
    () => new TypeError("Cannot read properties of undefined (reading 'installPath')")
  ],
  [
    'a Node error that carries a code',
    () => errorThrownBy(() => fs.readFileSync(undefined as unknown as string))
  ],
  [
    'a file-system error',
    () => errorThrownBy(() => fs.readFileSync('/no/such/folder/snapshot.json'))
  ],
  ['an aborted operation', () => new DOMException('The operation was aborted', 'AbortError')],
  [
    'an error class with its own name',
    () => new SignInFailure('OAuth token response was not an object', 'server_error')
  ],
  [
    'an error whose message names another error',
    () => new Error('SyntaxError: Unexpected end of JSON input')
  ],
  [
    'a message that spans lines',
    () => new Error('pip install failed\nERROR: No matching distribution found for torch')
  ],
  ['an Error with no message', () => new Error()]
]

describe('a failed call from a Desktop window to the main process', () => {
  beforeEach(() => {
    mainProcess.handlers.clear()
    page.removeListener.mockClear()
  })

  it.each(ERRORS_A_HANDLER_THROWS)(
    'gives the page only what the handler said when it throws %s',
    async (_kind, errorFromHandler) => {
      const thrown = errorFromHandler()
      handlerThrows('get-snapshot-detail', thrown)

      const caught = await messageThePageCatches(
        mainWindowApi().getSnapshotDetail('install-1', 'snapshot.json')
      )

      expect(caught).toBe(thrown.message)
      expect(caught).not.toContain('Error invoking remote method')
    }
  )

  it('says so in plain words when no handler is registered for the call', async () => {
    expect(await messageThePageCatches(mainWindowApi().getSources())).toBe(
      "No handler registered for 'get-sources'"
    )
  })

  it('cleans a failure inside a nested part of the API', async () => {
    handlerThrows('comfybuilder:signIn', new Error('Sign-in was not completed in the browser.'))

    expect(await messageThePageCatches(mainWindowApi().comfybuilder.signIn())).toBe(
      'Sign-in was not completed in the browser.'
    )
  })

  it('cleans a failure for the instance picker popup', async () => {
    handlerThrows('comfy-titlepopup:picker-run-action', new Error('Installation not found.'))

    expect(
      await messageThePageCatches(pickerPopup().pickerRunAction('install-1', 'snapshot-save'))
    ).toBe('Installation not found.')
  })

  it('cleans a failure for the terminal window', async () => {
    handlerThrows('terminal-subscribe', new Error('This installation has no terminal.'))

    expect(await messageThePageCatches(terminalWindow().subscribe())).toBe(
      'This installation has no terminal.'
    )
  })

  it('passes on untouched a failure that never reached a handler', async () => {
    const notSendable = (): void => {}

    await expect(mainWindowApi().setSetting('theme', notSendable)).rejects.toMatchObject({
      name: 'DataCloneError',
      message: errorThrownBy(() => structuredClone(notSendable)).message
    })
  })
})

describe('everything else a Desktop window gets from its preload', () => {
  beforeEach(() => {
    mainProcess.handlers.clear()
    page.removeListener.mockClear()
  })

  it('still receives what a handler returns', async () => {
    mainProcess.handlers.set('get-snapshot-diff', (installationId, filename, mode) => ({
      installationId,
      filename,
      mode
    }))

    await expect(
      mainWindowApi().getSnapshotDiff('install-1', 'snapshot.json', 'current')
    ).resolves.toEqual({ installationId: 'install-1', filename: 'snapshot.json', mode: 'current' })
  })

  it('still reads values and synchronous answers directly', () => {
    expect(mainWindowApi().platform).toBe(process.platform)
    expect(pickerPopup().platform).toBe(process.platform)
    expect(mainWindowApi().getPathForFile({ name: 'workflow.json' } as File)).toBe(
      '/dropped/workflow.json'
    )
  })

  it('still unsubscribes a listener with the function a subscription returns', () => {
    const unsubscribe = mainWindowApi().onInstallProgress(() => {})

    unsubscribe()

    expect(page.removeListener).toHaveBeenCalledWith('install-progress', expect.any(Function))
  })
})
