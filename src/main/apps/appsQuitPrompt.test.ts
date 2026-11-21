import { describe, expect, it } from 'vitest'

import { appsQuitPrompt, QUIT_BUTTON } from './appsQuitPrompt'

const COPY: Record<string, string> = {
  'appsQuit.message': 'Quit anyway?',
  'appsQuit.detailOne': '{app} is still making something. Quitting stops it.',
  'appsQuit.detailMany': '{count} apps are still making something. Quitting stops them.',
  'appsQuit.quit': 'Quit',
  'appsQuit.cancel': 'Cancel',
  'templateQuit.message': 'Quitting now will pause the download.'
}

function t(key: string, params: Record<string, string | number> = {}): string {
  return (COPY[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

describe('appsQuitPrompt', () => {
  it('asks nothing while no app is making something', () => {
    expect(appsQuitPrompt({ running: 0, onlyTitle: null, downloading: true }, t)).toBeNull()
  })

  it('asks like the close dialog, naming the one app, with Cancel as the safe answer', () => {
    const prompt = appsQuitPrompt(
      { running: 1, onlyTitle: 'Remove Background', downloading: false },
      t
    )

    expect(prompt).toMatchObject({
      message: 'Quit anyway?',
      detail: 'Remove Background is still making something. Quitting stops it.',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    expect(prompt?.buttons?.[QUIT_BUTTON]).toBe('Quit')
  })

  it('counts two or more apps', () => {
    expect(appsQuitPrompt({ running: 2, onlyTitle: null, downloading: false }, t)?.detail).toBe(
      '2 apps are still making something. Quitting stops them.'
    )
  })

  it('asks one question that also names the template download', () => {
    expect(
      appsQuitPrompt({ running: 1, onlyTitle: 'Remove Background', downloading: true }, t)?.detail
    ).toBe(
      'Remove Background is still making something. Quitting stops it.\n\nQuitting now will pause the download.'
    )
  })
})
