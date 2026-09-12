/**
 * Proves the starter-template picker resolves against the ComfyUI version the
 * install will actually run, using the real network path.
 *
 * The unit tests mock `fetchJSON`, so they can only assert which URL we ask
 * for. This runs inside Electron, where `net.request` works, and hits the real
 * `requirements.txt` and template indexes. That makes it the only place the
 * whole chain is exercised: read the pin a ComfyUI release ships, fetch that
 * revision's index, and drop or substitute a card that release cannot open.
 *
 * Anchored on `video_minimax_h3_t2v`, which is present in the index v0.30.2
 * pins and absent from the one v0.28.2 pins. That is the shipping bug: on an
 * older install the card renders and then cannot be opened.
 *
 * Network-dependent by design. Skipped when offline rather than failed, since
 * a red CI run here would say nothing about the code.
 */

import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { resolveStarterTemplateCards, type StarterTemplateCardLike } from './support/devHooks'

/** The picker option shape, as it crosses `window.api.getFieldOptions`. */
interface PickerOption {
  value: string
  label: string
  recommended?: boolean
  data?: { apiNode?: boolean }
}

/** In the index v0.30.2 pins, absent from the one v0.28.2 pins. */
const NEWER_ONLY_TEMPLATE = 'video_minimax_h3_t2v'
const OLDER_COMFY = 'v0.28.2'
const NEWER_COMFY = 'v0.30.2'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

const video = (cards: StarterTemplateCardLike[]): StarterTemplateCardLike[] =>
  cards.filter((c) => c.modality === 'video')

test('the picker offers only templates the target ComfyUI can open @windows @macos @linux', async () => {
  const older = await resolveStarterTemplateCards(ctx.app, OLDER_COMFY)
  const newer = await resolveStarterTemplateCards(ctx.app, NEWER_COMFY)

  // Offline, both resolutions fall back to the built-in list and the
  // comparison below proves nothing. Skip rather than report a false failure.
  test.skip(
    older.length === 0 || newer.length === 0,
    'needs network access to raw.githubusercontent.com'
  )
  const reachedPinnedIndex = newer.some((c) => c.id === NEWER_ONLY_TEMPLATE)
  test.skip(!reachedPinnedIndex, 'template index unreachable, nothing to compare')

  expect(
    video(older).map((c) => c.id),
    `${OLDER_COMFY} does not ship this template, so offering it renders a card that cannot open`
  ).not.toContain(NEWER_ONLY_TEMPLATE)

  expect(
    video(newer).map((c) => c.id),
    `${NEWER_COMFY} does ship it, so the pin must not over-filter`
  ).toContain(NEWER_ONLY_TEMPLATE)
})

test('every tab stays full on an older ComfyUI @windows @macos @linux', async () => {
  const cards = await resolveStarterTemplateCards(ctx.app, OLDER_COMFY)
  test.skip(cards.length === 0, 'needs network access')

  for (const modality of ['video', 'image', '3d', 'audio']) {
    const tab = cards.filter((c) => c.modality === modality)
    expect(tab, `${modality} tab`).toHaveLength(4)
    expect(
      tab.filter((c) => c.recommended),
      `${modality} auto-pick`
    ).toHaveLength(1)
    expect(
      tab.find((c) => c.recommended)?.apiNode,
      `${modality} auto-pick must not spend credits`
    ).toBe(false)
  }
  expect(new Set(cards.map((c) => c.id)).size, 'ids are the picker option key').toBe(cards.length)
})

test('previews come from the pinned revision, not main @windows @macos @linux', async () => {
  const cards = await resolveStarterTemplateCards(ctx.app, OLDER_COMFY)
  const withThumb = cards.find((c) => c.thumbnailUrl)
  test.skip(!withThumb, 'needs network access')

  // v0.28.2 pins comfyui-workflow-templates==0.11.12.
  expect(
    withThumb!.thumbnailUrl,
    'a main-revision preview beside a pinned card is two revisions in one card'
  ).toContain('/v0.11.12/')
})

test('the latest channel resolves against main @windows @macos @linux', async () => {
  const cards = await resolveStarterTemplateCards(ctx.app, null)
  const withThumb = cards.find((c) => c.thumbnailUrl)
  test.skip(!withThumb, 'needs network access')

  // Latest fast-forwards past the newest stable tag, so pinning it to that tag
  // would hide templates the install does support.
  expect(withThumb!.thumbnailUrl, 'latest must not wear an older tag').toContain('/main/')
})

/**
 * The tests above call the resolver directly. These go through the renderer's
 * own IPC instead, the same call the install wizard makes, so the wiring
 * between a picked release/version and the cards the picker renders is covered
 * rather than assumed.
 */
async function pickerOptions(release: string, comfyVersion?: string): Promise<PickerOption[]> {
  const selections: Record<string, unknown> = {
    release: { value: release, label: release, data: { latestStableTag: NEWER_COMFY } }
  }
  if (comfyVersion) selections.comfyVersion = { value: comfyVersion, label: comfyVersion }
  return await ctx.panel.evaluate<PickerOption[]>(
    `window.api.getFieldOptions('standalone', 'bundledTemplate', ${JSON.stringify(selections)})`
  )
}

test('the wizard renders version-correct cards through its own IPC @windows @macos @linux', async () => {
  const older = await pickerOptions('stable', OLDER_COMFY)
  const newer = await pickerOptions('stable', NEWER_COMFY)
  test.skip(older.length === 0 || newer.length === 0, 'needs network access')

  const ids = (options: PickerOption[]): string[] => options.map((o) => o.value)
  test.skip(!ids(newer).includes(NEWER_ONLY_TEMPLATE), 'template index unreachable')

  expect(
    ids(older),
    `picking ${OLDER_COMFY} must not surface a card that release cannot open`
  ).not.toContain(NEWER_ONLY_TEMPLATE)
  expect(ids(newer), `${NEWER_COMFY} ships it, so it must still be offered`).toContain(
    NEWER_ONLY_TEMPLATE
  )
})

test('the wizard always offers a skip plus four cards per tab @windows @macos @linux', async () => {
  const options = await pickerOptions('stable', OLDER_COMFY)
  test.skip(options.length === 0, 'needs network access')

  // "None" leads the list, then four cards in each of four modalities.
  expect(options[0]!.value, 'the skip option must come first').toBe('none')
  expect(options.length, 'skip + 4 cards x 4 tabs').toBe(17)

  const recommended = options.filter((o) => o.recommended)
  expect(recommended, 'one auto-pick per tab').toHaveLength(4)
  for (const option of recommended) {
    expect(
      option.data?.apiNode,
      `${option.value} is auto-selected, so it must not spend credits`
    ).toBeFalsy()
  }
})
