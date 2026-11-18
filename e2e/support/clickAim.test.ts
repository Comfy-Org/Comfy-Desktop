/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aimAndWatchPressScript,
  clickUntilLanded,
  PRESS_OUTCOME_EXPRESSION,
  PRESS_PATIENCE_MS
} from './clickAim'
import type { AimOutcome, ClickAttempt, ClickPoint, PressOutcome } from './clickAim'

const FIRST_CARD = `document.querySelector('#first')`
const SECOND_CARD = `document.querySelector('#second')`
const CARD_WIDTH_PX = 100
const SHIFT_THAT_PUTS_THE_FIRST_CARD_UNDER_THE_OLD_AIM_PX = 75

let opened: string[]
let pressesSeenByThePage: string[]

function inPage<T>(script: string): Promise<T> {
  return Promise.resolve((0, eval)(script) as T)
}

function aimAt(elementExpression: string, patienceMs = 1000): Promise<AimOutcome> {
  return inPage<AimOutcome>(aimAndWatchPressScript(elementExpression, patienceMs))
}

function pressOutcome(): Promise<PressOutcome> {
  return inPage<PressOutcome>(PRESS_OUTCOME_EXPRESSION)
}

function deliver(type: string, point: ClickPoint): boolean {
  const target = document.elementFromPoint(point.x, point.y)
  if (!target) return true
  const Kind = type.startsWith('pointer') ? PointerEvent : MouseEvent
  return target.dispatchEvent(
    new Kind(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      button: 0
    })
  )
}

function pressLikeTheBrowserWould(point: ClickPoint): void {
  const mouseEventsFollow = deliver('pointerdown', point)
  if (mouseEventsFollow) deliver('mousedown', point)
  deliver('pointerup', point)
  if (mouseEventsFollow) deliver('mouseup', point)
  deliver('click', point)
}

function reflowTheCards(): void {
  const grid = document.querySelector<HTMLElement>('#grid')
  if (!grid) throw new Error('the cards are not mounted')
  grid.style.left = `${SHIFT_THAT_PUTS_THE_FIRST_CARD_UNDER_THE_OLD_AIM_PX}px`
}

function pointOf(aim: AimOutcome): ClickPoint {
  if (typeof aim === 'string') throw new Error(`the card could not be aimed at: ${aim}`)
  return aim
}

async function clickOnce(
  elementExpression: string,
  patienceMs: number,
  beforeThePressArrives: () => void = () => {}
): Promise<ClickAttempt> {
  const aim = await aimAt(elementExpression, patienceMs)
  if (typeof aim === 'string') return aim
  beforeThePressArrives()
  pressLikeTheBrowserWould(aim)
  return (await pressOutcome()) === 'missed' ? 'missed' : 'clicked'
}

beforeEach(() => {
  opened = []
  pressesSeenByThePage = []
  document.body.innerHTML = `
    <div id="grid" style="position: fixed; top: 0; left: 0; display: flex">
      <button id="first" type="button" style="width: ${CARD_WIDTH_PX}px; height: 100px">First</button>
      <button id="second" type="button" style="width: ${CARD_WIDTH_PX}px; height: 100px">Second</button>
    </div>`
  document.querySelectorAll('button').forEach((card) => {
    card.addEventListener('click', () => opened.push(card.id))
    card.addEventListener('pointerdown', () => pressesSeenByThePage.push(card.id))
    card.addEventListener('mousedown', () => pressesSeenByThePage.push(card.id))
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a click aimed at an element', () => {
  it('opens the element when it holds still', async () => {
    pressLikeTheBrowserWould(pointOf(await aimAt(SECOND_CARD)))

    expect(await pressOutcome()).toBe('landed')
    expect(opened).toEqual(['second'])
  })

  it('opens nothing, and says it missed, when the layout moved another element under the pointer before the press arrived', async () => {
    const staleAim = pointOf(await aimAt(SECOND_CARD))
    reflowTheCards()
    expect(document.elementFromPoint(staleAim.x, staleAim.y)?.id).toBe('first')

    pressLikeTheBrowserWould(staleAim)

    expect(await pressOutcome()).toBe('missed')
    expect(opened).toEqual([])
    expect(pressesSeenByThePage).toEqual([])
  })

  it('leaves later presses alone once its own press has been judged', async () => {
    const staleAim = pointOf(await aimAt(SECOND_CARD))
    reflowTheCards()
    pressLikeTheBrowserWould(staleAim)
    expect(await pressOutcome()).toBe('missed')

    pressLikeTheBrowserWould(staleAim)

    expect(opened).toEqual(['first'])
  })

  it(
    'stops judging presses when none arrives in time',
    async () => {
      const staleAim = pointOf(await aimAt(SECOND_CARD))
      reflowTheCards()

      expect(await pressOutcome()).toBe('unseen')
      pressLikeTheBrowserWould(staleAim)

      expect(opened).toEqual(['first'])
    },
    5 * PRESS_PATIENCE_MS
  )

  it('judges only the newest aim when an earlier one never saw its press', async () => {
    await aimAt(FIRST_CARD)

    pressLikeTheBrowserWould(pointOf(await aimAt(SECOND_CARD)))

    expect(await pressOutcome()).toBe('landed')
    expect(opened).toEqual(['second'])
  })

  it('reports a missing element without waiting for a press', async () => {
    expect(await aimAt(`document.querySelector('#gone')`)).toBe('missing')
  })

  it('reports an element that stays covered as blocked', async () => {
    const cover = document.createElement('div')
    cover.style.cssText = 'position: fixed; inset: 0'
    document.body.append(cover)

    expect(await aimAt(SECOND_CARD, 100)).toBe('blocked')
  })
})

describe('clicking until the press lands', () => {
  it('aims again after a miss and opens the element where it came to rest', async () => {
    let attempts = 0

    const outcome = await clickUntilLanded((patienceMs) => {
      attempts += 1
      return clickOnce(SECOND_CARD, patienceMs, attempts === 1 ? reflowTheCards : undefined)
    })

    expect(outcome).toBe('clicked')
    expect(attempts).toBe(2)
    expect(opened).toEqual(['second'])
  })

  it('gives up as moving when every press misses until the patience runs out', async () => {
    const outcome = await clickUntilLanded(() => Promise.resolve('missed'), 120)

    expect(outcome).toBe('moving')
  })

  it.for(['missing', 'blocked'] as const)(
    'stops at once when the element is %s',
    async (attempt) => {
      let attempts = 0

      const outcome = await clickUntilLanded(() => {
        attempts += 1
        return Promise.resolve(attempt)
      })

      expect(outcome).toBe(attempt)
      expect(attempts).toBe(1)
    }
  )
})
