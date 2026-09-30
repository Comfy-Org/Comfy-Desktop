import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchText = vi.fn()
vi.mock('../../lib/fetch', () => ({ fetchText: (...a: unknown[]) => fetchText(...a) }))

import {
  resolveTemplatePackageVersion,
  templateIndexUrlFor,
  parseTemplatePin,
  _resetForTest
} from './templatePin'
import { INDEX_URL } from './curatedTemplates'

function requirements(pin: string | null): string {
  return [
    'comfyui-frontend-package==1.47.12',
    ...(pin ? [pin] : []),
    'comfyui-embedded-docs==0.5.9',
    'torch',
    'numpy>=1.25.0'
  ].join('\n')
}

beforeEach(() => {
  _resetForTest()
  fetchText.mockReset()
})

describe('parseTemplatePin', () => {
  it('reads the hyphenated package name ComfyUI actually pins', () => {
    expect(
      parseTemplatePin(requirements('comfyui-workflow-templates==0.11.31')),
      'the pin uses the hyphenated package name'
    ).toBe('0.11.31')
  })

  it('does not match the underscored form', () => {
    expect(
      parseTemplatePin(requirements('comfyui_workflow_templates==0.11.31')),
      'the underscored form is the Python import path, never the pin'
    ).toBeNull()
  })

  it('tolerates surrounding whitespace and comments', () => {
    expect(parseTemplatePin('  comfyui-workflow-templates==0.11.31  # pinned\n')).toBe('0.11.31')
  })

  it.each([
    ['absent', requirements(null)],
    ['no version', requirements('comfyui-workflow-templates==')],
    ['range not pin', requirements('comfyui-workflow-templates>=0.11.0')],
    ['empty file', ''],
    ['garbage', 'this is not a requirements file'],
    ['non-numeric', requirements('comfyui-workflow-templates==abc')]
  ])('%s yields null', (_label, contents) => {
    expect(parseTemplatePin(contents)).toBeNull()
  })
})

describe('resolveTemplatePackageVersion', () => {
  it('resolves a tag through requirements.txt to the pinned version', async () => {
    fetchText.mockResolvedValue(requirements('comfyui-workflow-templates==0.11.31'))
    expect(await resolveTemplatePackageVersion('v0.30.2')).toBe('0.11.31')
    expect(fetchText).toHaveBeenCalledWith(
      expect.stringContaining('v0.30.2/requirements.txt'),
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('treats a bare version and a v-prefixed tag identically', async () => {
    fetchText.mockResolvedValue(requirements('comfyui-workflow-templates==0.11.31'))
    const prefixed = await resolveTemplatePackageVersion('v0.30.2')
    _resetForTest()
    fetchText.mockClear()
    fetchText.mockResolvedValue(requirements('comfyui-workflow-templates==0.11.31'))
    const bare = await resolveTemplatePackageVersion('0.30.2')
    expect(bare).toBe(prefixed)
    expect(fetchText, 'the bare tag is the one normalized to v0.30.2').toHaveBeenCalledWith(
      expect.stringContaining('v0.30.2/requirements.txt'),
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it.each([[null], [undefined], ['']])('returns null for an unresolvable tag: %s', async (tag) => {
    expect(await resolveTemplatePackageVersion(tag as string | null)).toBeNull()
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('rejects a tag that is not version-shaped without fetching', async () => {
    expect(await resolveTemplatePackageVersion('../../etc/passwd')).toBeNull()
    expect(await resolveTemplatePackageVersion('master')).toBeNull()
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('returns null when requirements.txt 404s', async () => {
    fetchText.mockRejectedValue(new Error('HTTP 404'))
    expect(await resolveTemplatePackageVersion('v9.99.99')).toBeNull()
  })

  it('returns null when the fetch rejects, without throwing', async () => {
    fetchText.mockRejectedValue(new Error('offline'))
    await expect(resolveTemplatePackageVersion('v0.30.2')).resolves.toBeNull()
  })

  it('caches a resolved tag — one network hit for repeat lookups', async () => {
    fetchText.mockResolvedValue(requirements('comfyui-workflow-templates==0.11.31'))
    await resolveTemplatePackageVersion('v0.30.2')
    await resolveTemplatePackageVersion('v0.30.2')
    expect(fetchText).toHaveBeenCalledTimes(1)
  })

  it('caches a failure too, so a 404 is not refetched every picker open', async () => {
    fetchText.mockRejectedValue(new Error('404'))
    await resolveTemplatePackageVersion('v0.28.2')
    await resolveTemplatePackageVersion('v0.28.2')
    expect(fetchText).toHaveBeenCalledTimes(1)
  })

  it('keeps separate tags separate', async () => {
    fetchText.mockImplementation((url: string) =>
      Promise.resolve(
        requirements(
          url.includes('v0.28.2')
            ? 'comfyui-workflow-templates==0.11.12'
            : 'comfyui-workflow-templates==0.11.31'
        )
      )
    )
    expect(await resolveTemplatePackageVersion('v0.28.2')).toBe('0.11.12')
    expect(await resolveTemplatePackageVersion('v0.30.2')).toBe('0.11.31')
  })
})

describe('templateIndexUrlFor', () => {
  it('builds the versioned index URL for a resolved pin', () => {
    expect(templateIndexUrlFor('0.11.31')).toBe(
      'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/v0.11.31/templates/index.json'
    )
  })

  it('falls back to the live main index when the pin is unknown', () => {
    expect(templateIndexUrlFor(null), 'fails open to today’s behaviour').toBe(INDEX_URL)
  })

  it('refuses a pin that is not version-shaped', () => {
    expect(templateIndexUrlFor('../../evil')).toBe(INDEX_URL)
    expect(templateIndexUrlFor('main')).toBe(INDEX_URL)
  })
})
