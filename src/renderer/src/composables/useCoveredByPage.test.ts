import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { isCoveredByPage } from './useCoveredByPage'

beforeAll(() => page.viewport(1280, 800))

const added: HTMLElement[] = []

function place(css: string, parent: HTMLElement = document.body): HTMLElement {
  const element = document.createElement('div')
  element.style.cssText = `position: fixed; ${css}`
  parent.append(element)
  added.push(element)
  return element
}

afterEach(() => {
  for (const element of added.splice(0)) element.remove()
})

describe('isCoveredByPage', () => {
  it('is false for an area with only its own content in it', () => {
    const area = place('left: 300px; top: 20px; width: 600px; height: 400px')
    place('left: 320px; top: 40px; width: 100px; height: 100px', area)

    expect(isCoveredByPage(area)).toBe(false)
  })

  it('is false for a rounded area whose corners show the surface behind it', () => {
    const surface = place('left: 280px; top: 0; width: 640px; height: 440px')
    const area = place(
      'left: 300px; top: 20px; width: 600px; height: 400px; border-radius: 14px',
      surface
    )

    expect(isCoveredByPage(area)).toBe(false)
  })

  it('is true when a small menu sits anywhere over the area', () => {
    const area = place('left: 300px; top: 20px; width: 600px; height: 400px')
    place('left: 610px; top: 230px; width: 90px; height: 60px; z-index: 5')

    expect(isCoveredByPage(area)).toBe(true)
  })

  it('is true when something overlaps only the very edge of the area', () => {
    const area = place('left: 300px; top: 20px; width: 600px; height: 400px')
    place('left: 100px; top: 380px; width: 202px; height: 41px; z-index: 5')

    expect(isCoveredByPage(area)).toBe(true)
  })

  it('is false for something that stops just short of the area', () => {
    const area = place('left: 300px; top: 20px; width: 600px; height: 400px')
    place('left: 100px; top: 380px; width: 200px; height: 40px; z-index: 5')

    expect(isCoveredByPage(area)).toBe(false)
  })

  it('is true under a full-window dialog backdrop', () => {
    const area = place('left: 300px; top: 20px; width: 600px; height: 400px')
    place('inset: 0; z-index: 50')

    expect(isCoveredByPage(area)).toBe(true)
  })

  it('is false for an area with no size', () => {
    const area = place('left: 300px; top: 20px; width: 0; height: 0')

    expect(isCoveredByPage(area)).toBe(false)
  })
})
