import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Session } from 'electron'

const mocks = vi.hoisted(() => ({
  savedListBody: vi.fn<(listUrl: string) => Promise<string | null>>()
}))

vi.mock('./appsCatalog', () => ({
  appsListUrl: (location: { url: string }) => new URL('apps.json', location.url).toString(),
  savedListBody: mocks.savedListBody
}))
vi.mock('./appsConfig', () => ({
  currentAppsLocation: () => ({
    url: 'https://comfy.org/apps/',
    origin: 'https://comfy.org',
    scopePath: '/apps/'
  })
}))

import {
  answerFromKeptCopy,
  answersFromKeptCopies,
  startAnsweringFromKeptCopies,
  stopAnsweringFromKeptCopies
} from './appsOffline'

const PAGE_URL = 'https://comfy.org/apps/remove-background/desktop.html'
const LIST_URL = 'https://comfy.org/apps/apps.json'
const COMFY = { url: 'https://comfy.org/apps/', origin: 'https://comfy.org', scopePath: '/apps/' }

interface FakeSession {
  fetch: Mock<(url: string, init?: RequestInit) => Promise<Response>>
  protocol: { handle: Mock; unhandle: Mock }
}

let appsSession: FakeSession

function asSession(fake: FakeSession): Session {
  return fake as unknown as Session
}

function answer(request: Request): Promise<Response> {
  return answerFromKeptCopy(asSession(appsSession), request)
}

beforeEach(() => {
  mocks.savedListBody.mockReset().mockResolvedValue(null)
  appsSession = { fetch: vi.fn(), protocol: { handle: vi.fn(), unhandle: vi.fn() } }
})

describe('answering the apps session from kept copies', () => {
  it('answers every https request of the apps session once started, and only once', () => {
    startAnsweringFromKeptCopies(asSession(appsSession), COMFY)
    startAnsweringFromKeptCopies(asSession(appsSession), COMFY)

    expect(appsSession.protocol.handle.mock.calls.map(([scheme]) => scheme)).toEqual(['https'])
    expect(answersFromKeptCopies(asSession(appsSession))).toBe(true)
  })

  it('also answers http when the apps site is a local one', () => {
    startAnsweringFromKeptCopies(asSession(appsSession), {
      url: 'http://127.0.0.1:4321/apps/',
      origin: 'http://127.0.0.1:4321',
      scopePath: '/apps/'
    })

    expect(appsSession.protocol.handle.mock.calls.map(([scheme]) => scheme)).toEqual([
      'https',
      'http'
    ])
  })

  it('hands every request back to the network once stopped', () => {
    startAnsweringFromKeptCopies(asSession(appsSession), COMFY)

    stopAnsweringFromKeptCopies(asSession(appsSession))
    stopAnsweringFromKeptCopies(asSession(appsSession))

    expect(appsSession.protocol.unhandle.mock.calls).toEqual([['https']])
    expect(answersFromKeptCopies(asSession(appsSession))).toBe(false)
  })

  it('answers nothing before it is started', () => {
    expect(answersFromKeptCopies(asSession(appsSession))).toBe(false)
    expect(appsSession.protocol.handle).not.toHaveBeenCalled()
  })
})

describe('a page file from the apps site', () => {
  it('comes from the copy Chromium kept, without the page headers that would skip it', async () => {
    const kept = new Response('<p>kept</p>')
    appsSession.fetch.mockResolvedValue(kept)

    const response = await answer(new Request(PAGE_URL, { headers: { 'if-none-match': '"v1"' } }))

    expect(response).toBe(kept)
    expect(appsSession.fetch).toHaveBeenCalledWith(PAGE_URL, {
      cache: 'force-cache',
      bypassCustomProtocolHandlers: true
    })
  })

  it('fails the load when no copy was kept and the network fails', async () => {
    appsSession.fetch.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))

    await expect(answer(new Request(PAGE_URL))).rejects.toThrow('ERR_INTERNET_DISCONNECTED')
  })
})

describe('the apps list a page reads', () => {
  it('comes from the list Desktop saved', async () => {
    mocks.savedListBody.mockResolvedValue('[{"id":"remove-background"}]')

    const response = await answer(new Request(`${LIST_URL}?v=2`))

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await response.json()).toEqual([{ id: 'remove-background' }])
    expect(mocks.savedListBody).toHaveBeenCalledWith(LIST_URL)
    expect(appsSession.fetch).not.toHaveBeenCalled()
  })

  it('comes from the kept copy when Desktop saved no list', async () => {
    const kept = new Response('[]')
    appsSession.fetch.mockResolvedValue(kept)

    expect(await answer(new Request(LIST_URL))).toBe(kept)
  })
})

describe('requests that keep no copy', () => {
  it('sends a POST straight on, with its body', async () => {
    const sentOn = new Response('{}')
    appsSession.fetch.mockResolvedValue(sentOn)
    const request = new Request('https://comfy.org/api/upload', { method: 'POST', body: 'picture' })

    expect(await answer(request)).toBe(sentOn)
    const [url, init] = appsSession.fetch.mock.calls[0] ?? []
    expect(url).toBe('https://comfy.org/api/upload')
    expect(init).toMatchObject({
      method: 'POST',
      duplex: 'half',
      bypassCustomProtocolHandlers: true
    })
  })

  it('sends a request for part of a file straight on', async () => {
    appsSession.fetch.mockResolvedValue(new Response(''))

    await answer(
      new Request('https://comfy.org/catalog-media/clip/v1', { headers: { range: 'bytes=0-' } })
    )

    expect(appsSession.fetch).toHaveBeenCalledWith(
      'https://comfy.org/catalog-media/clip/v1',
      expect.objectContaining({ method: 'GET', bypassCustomProtocolHandlers: true })
    )
    expect(appsSession.fetch.mock.calls[0]?.[1]).not.toHaveProperty('cache')
  })

  it('sends a request to another site straight on', async () => {
    appsSession.fetch.mockResolvedValue(new Response('{}'))

    await answer(new Request('https://cloud.comfy.org/api/jobs'))

    expect(appsSession.fetch).toHaveBeenCalledWith(
      'https://cloud.comfy.org/api/jobs',
      expect.objectContaining({ method: 'GET', bypassCustomProtocolHandlers: true })
    )
    expect(appsSession.fetch.mock.calls[0]?.[1]).not.toHaveProperty('cache')
  })
})
