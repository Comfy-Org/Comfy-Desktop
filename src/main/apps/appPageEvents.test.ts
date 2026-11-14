import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'launcher-test'),
    isPackaged: true,
    on: () => {}
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const sdkCaptures = vi.hoisted(
  () => [] as Array<{ event: string; properties?: Record<string, unknown> }>
)

vi.mock('posthog-node', () => ({
  PostHog: class {
    on(): () => void {
      return () => {}
    }
    capture(call: { event: string; properties?: Record<string, unknown> }): void {
      sdkCaptures.push(call)
    }
    identify(): void {}
    flush(): Promise<void> {
      return Promise.resolve()
    }
    shutdown(): Promise<void> {
      return Promise.resolve()
    }
  }
}))

import * as telemetry from '../lib/telemetry'
import { APP_PAGE_EVENT_PREFIX, checkAppPageEvent, trackAppPageEvent } from './appPageEvents'

describe('checkAppPageEvent', () => {
  it('keeps a run start with every property it knows, under the Apps prefix', () => {
    expect(
      checkAppPageEvent('run_started', {
        app: 'remove-background',
        where: 'cloud',
        model: 'birefnet',
        quality: 'best',
        seconds: 12.4
      })
    ).toEqual({
      event: 'comfy.desktop.apps.run_started',
      properties: {
        app_id: 'remove-background',
        where: 'cloud',
        model: 'birefnet',
        quality: 'best',
        seconds: 12
      }
    })
  })

  it('keeps an example use and an open in ComfyUI', () => {
    expect(checkAppPageEvent('example_used', { app: 'genjutsu', example: 'dance-1' })).toEqual({
      event: `${APP_PAGE_EVENT_PREFIX}example_used`,
      properties: { app_id: 'genjutsu', example: 'dance-1' }
    })
    expect(checkAppPageEvent('open_in_comfyui', { app: 'genjutsu', where: 'local' })).toEqual({
      event: `${APP_PAGE_EVENT_PREFIX}open_in_comfyui`,
      properties: { app_id: 'genjutsu', where: 'local' }
    })
  })

  it.each([
    ['app_opened', { app: 'genjutsu' }],
    ['app_page_failed', { app: 'genjutsu' }],
    ['run_finished', { app: 'genjutsu', where: 'cloud' }],
    ['toString', { app: 'genjutsu', where: 'cloud' }],
    ['', { app: 'genjutsu' }],
    [42, { app: 'genjutsu' }]
  ])('drops the event %s, which a page may not send', (name, props) => {
    expect(checkAppPageEvent(name, props)).toBeNull()
  })

  it('leaves app_opened to Desktop, which sends it when it opens the page', () => {
    expect(checkAppPageEvent('app_opened', { app: 'genjutsu' })).toBeNull()
  })

  it.each([
    ['no app', { where: 'cloud' }],
    ['an app that is not a slug', { app: 'Remove Background', where: 'cloud' }],
    ['an app that is too long', { app: 'a'.repeat(65), where: 'cloud' }],
    ['no where', { app: 'genjutsu' }],
    ['a where that is neither cloud nor local', { app: 'genjutsu', where: 'mars' }],
    ['properties that are not an object', 'genjutsu'],
    ['properties that are a list', ['genjutsu', 'cloud']],
    ['no properties', undefined]
  ])('drops a run start with %s', (_why, props) => {
    expect(checkAppPageEvent('run_started', props)).toBeNull()
  })

  it('drops an example use whose example is not a slug', () => {
    expect(checkAppPageEvent('example_used', { app: 'genjutsu', example: '../x' })).toBeNull()
  })

  it('drops properties it does not know and bad optional ones, keeping the event', () => {
    expect(
      checkAppPageEvent('run_started', {
        app: 'genjutsu',
        where: 'local',
        model: 'My Model.safetensors',
        quality: 'ultra',
        seconds: 86_401,
        prompt: 'a cat on the moon',
        path: '/Users/someone/Pictures/me.png',
        app_id: 'other-app',
        example: 'dance-1'
      })
    ).toEqual({
      event: 'comfy.desktop.apps.run_started',
      properties: { app_id: 'genjutsu', where: 'local' }
    })
  })

  it.each([
    [0, undefined],
    [-3, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    ['12', undefined],
    [0.2, 1],
    [59.5, 60],
    [86_400, 86_400]
  ])('reads seconds %s as %s', (seconds, kept) => {
    expect(
      checkAppPageEvent('run_started', { app: 'genjutsu', where: 'cloud', seconds })?.properties[
        'seconds'
      ]
    ).toBe(kept)
  })
})

describe('trackAppPageEvent through Desktop telemetry', () => {
  beforeEach(() => {
    process.env['POSTHOG_API_KEY'] = 'test-key'
    process.env['POSTHOG_ENABLED'] = '1'
    telemetry._resetForTest()
    telemetry.initTelemetry({ appVersion: '0.0.0', appEnv: 'test', isPackaged: true })
  })

  afterEach(() => {
    telemetry._resetForTest()
    sdkCaptures.length = 0
    delete process.env['POSTHOG_API_KEY']
    delete process.env['POSTHOG_ENABLED']
  })

  function appCaptures(): Array<{ event: string; properties?: Record<string, unknown> }> {
    return sdkCaptures.filter((c) => c.event.startsWith(APP_PAGE_EVENT_PREFIX))
  }

  it('sends a good event to PostHog when the person allows telemetry', () => {
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})

    expect(
      trackAppPageEvent('run_started', { app: 'genjutsu', where: 'cloud', prompt: 'a cat' })
    ).toBe(true)

    const sent = appCaptures()
    expect(sent.map((c) => c.event)).toEqual(['comfy.desktop.apps.run_started'])
    expect(sent[0]?.properties).toMatchObject({ app_id: 'genjutsu', where: 'cloud' })
    expect(sent[0]?.properties).not.toHaveProperty('prompt')
  })

  it.each(['denied', 'undecided'] as const)('sends nothing while consent is %s', (consent) => {
    telemetry.setConsentState(consent)
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})

    expect(trackAppPageEvent('run_started', { app: 'genjutsu', where: 'cloud' })).toBe(false)
    expect(trackAppPageEvent('example_used', { app: 'genjutsu', example: 'dance-1' })).toBe(false)

    expect(appCaptures()).toEqual([])
  })

  it('sends nothing for an event it drops, even with consent', () => {
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})

    expect(trackAppPageEvent('app_opened', { app: 'genjutsu' })).toBe(false)
    expect(trackAppPageEvent('mystery', { app: 'genjutsu' })).toBe(false)

    expect(appCaptures()).toEqual([])
  })
})
