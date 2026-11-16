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
import {
  APP_PAGE_EVENT_PREFIX,
  DESKTOP_APP_EVENTS,
  MAX_PAGE_EVENT_PROPERTIES,
  UNLIMITED_EVENT_NAMES,
  _resetPageEventLimitsForTest,
  checkAppPageEvent,
  trackAppPageEvent
} from './appPageEvents'

const APP = 'remove-background'

describe('checkAppPageEvent', () => {
  it('sends a page event under the Apps prefix with the app id Desktop holds', () => {
    expect(
      checkAppPageEvent(
        'run_started',
        { where: 'cloud', model: 'birefnet', seconds: 12.4, fast: true },
        APP
      )
    ).toEqual({
      event: 'comfy.desktop.apps.run_started',
      properties: { where: 'cloud', model: 'birefnet', seconds: 12.4, fast: true, app_id: APP }
    })
  })

  it.each(['click', 'run_started', 'example_used', 'a', `a${'b'.repeat(47)}`, 'step_2_done'])(
    'accepts the event name %s',
    (name) => {
      expect(checkAppPageEvent(name, {}, APP)?.event).toBe(`${APP_PAGE_EVENT_PREFIX}${name}`)
    }
  )

  it.each([
    ['too long', `a${'b'.repeat(48)}`],
    ['starting with a digit', '2fast'],
    ['starting with an underscore', '_hidden'],
    ['with capitals', 'RunStarted'],
    ['with a dot', 'apps.run_started'],
    ['with a dash', 'run-started'],
    ['with a space', 'run started'],
    ['empty', ''],
    ['not a string', 42]
  ])('refuses an event name %s', (_why, name) => {
    expect(checkAppPageEvent(name, {}, APP)).toBeNull()
  })

  it.each([...DESKTOP_APP_EVENTS])('refuses %s, which only Desktop sends', (name) => {
    expect(['app_opened', 'app_page_failed']).toContain(name)
    expect(checkAppPageEvent(name, {}, APP)).toBeNull()
  })

  it('takes app_id from Desktop and ignores the app the page names', () => {
    expect(
      checkAppPageEvent('click', { app: 'other-app', app_id: 'other-app', target: 'run' }, APP)
    ).toEqual({
      event: 'comfy.desktop.apps.click',
      properties: { target: 'run', app_id: APP }
    })
  })

  it.each([
    ['no app id', null],
    ['an app id the catalog would not list', 'Remove Background'],
    ['an app id with a dot', 'remove.background'],
    ['an app id longer than the catalog allows', `a${'b'.repeat(128)}`]
  ])('drops the event when Desktop holds %s for the page', (_why, appId) => {
    expect(checkAppPageEvent('click', { target: 'run' }, appId)).toBeNull()
  })

  it.each(['HDR', 'Upscale_4x', `a${'b'.repeat(127)}`])(
    'keeps the catalog app id %s as Desktop holds it',
    (appId) => {
      expect(checkAppPageEvent('click', {}, appId)?.properties).toEqual({ app_id: appId })
    }
  )

  it('refuses error, whose full name the shared telemetry limit lets through unlimited', () => {
    expect(UNLIMITED_EVENT_NAMES.has('error')).toBe(true)
    expect(checkAppPageEvent('error', {}, APP)).toBeNull()
    expect(checkAppPageEvent('run_error', {}, APP)?.event).toBe('comfy.desktop.apps.run_error')
  })

  it('drops free text, bad values and bad property names, keeping the event', () => {
    expect(
      checkAppPageEvent(
        'run_started',
        {
          where: 'local',
          prompt: 'a cat on the moon',
          file: '/Users/someone/Pictures/me.png',
          name: 'My Model.safetensors',
          long: 'a'.repeat(65),
          nan: Number.NaN,
          forever: Number.POSITIVE_INFINITY,
          nothing: null,
          list: ['a'],
          nested: { a: 1 },
          Capital: 'x',
          '1st': 'x',
          [`a${'b'.repeat(32)}`]: 'x',
          $set: 'x',
          app_version: '9.9.9',
          installation_id: 'fake',
          ok: false,
          count: 0
        },
        APP
      )
    ).toEqual({
      event: 'comfy.desktop.apps.run_started',
      properties: { where: 'local', ok: false, count: 0, app_id: APP }
    })
  })

  it('keeps a 64-character slug and a 32-character property name', () => {
    const key = `a${'b'.repeat(31)}`
    const value = `a${'b'.repeat(63)}`
    expect(checkAppPageEvent('click', { [key]: value }, APP)?.properties).toEqual({
      [key]: value,
      app_id: APP
    })
  })

  it(`keeps at most ${MAX_PAGE_EVENT_PROPERTIES} properties besides app_id`, () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, i]))
    const kept = checkAppPageEvent('click', many, APP)?.properties ?? {}
    expect(Object.keys(kept)).toHaveLength(MAX_PAGE_EVENT_PROPERTIES + 1)
    expect(kept).toMatchObject({ p0: 0, p15: 15, app_id: APP })
    expect(kept).not.toHaveProperty('p16')
  })

  it.each([
    ['not an object', 'run'],
    ['a list', ['run']],
    ['missing', undefined]
  ])('sends only app_id when the properties are %s', (_why, props) => {
    expect(checkAppPageEvent('click', props, APP)?.properties).toEqual({ app_id: APP })
  })
})

describe('trackAppPageEvent through Desktop telemetry', () => {
  beforeEach(() => {
    process.env['POSTHOG_API_KEY'] = 'test-key'
    process.env['POSTHOG_ENABLED'] = '1'
    telemetry._resetForTest()
    _resetPageEventLimitsForTest()
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

    expect(trackAppPageEvent('run_started', { where: 'cloud', prompt: 'a cat' }, APP)).toBe(true)

    const sent = appCaptures()
    expect(sent.map((c) => c.event)).toEqual(['comfy.desktop.apps.run_started'])
    expect(sent[0]?.properties).toMatchObject({ app_id: APP, where: 'cloud' })
    expect(sent[0]?.properties).not.toHaveProperty('prompt')
  })

  it.each(['denied', 'undecided'] as const)('sends nothing while consent is %s', (consent) => {
    telemetry.setConsentState(consent)
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})

    expect(trackAppPageEvent('run_started', { where: 'cloud' }, APP)).toBe(false)
    expect(trackAppPageEvent('click', { target: 'run' }, APP)).toBe(false)

    expect(appCaptures()).toEqual([])
  })

  it('sends nothing for an event it refuses, even with consent', () => {
    telemetry.setConsentState('granted')
    telemetry.bindAnonymousId('anon-1', 'anon-1', {})

    expect(trackAppPageEvent('app_opened', {}, APP)).toBe(false)
    expect(trackAppPageEvent('Not An Event', {}, APP)).toBe(false)
    expect(trackAppPageEvent('click', {}, null)).toBe(false)

    expect(appCaptures()).toEqual([])
  })
})
