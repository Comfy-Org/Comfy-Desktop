/**
 * Guards `starter-templates.mjs` against edits that would break the picker
 * silently. Every case here is a state the app cannot report: a short tab
 * quietly backfills, a paid auto-pick spends credits on first run, and a
 * missing size makes the disk-space check under-count.
 *
 * Runs on `node --test`, against the real script and the live template index.
 * No test framework: this has to be runnable in CI without installing the
 * app's dependencies.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'assets', 'starter-templates.json')
const SCRIPT = path.join(ROOT, 'scripts', 'starter-templates.mjs')
const ORIGINAL = fs.readFileSync(FILE, 'utf-8')

// Mirrors the script's own constants (kept local to avoid importing it).
const MODALITIES = ['video', 'image', '3d', 'audio']
const SLOTS = 4

const run = (...args) => {
  try {
    // Merge stderr into stdout: warnings (upstream drift) go to stderr even on
    // a successful run, and assertions need to see them.
    const out = execFileSync('node', [SCRIPT, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8'
    })
    return { ok: true, err: out ?? '' }
  } catch (e) {
    // Carries stderr so a rejection can be asserted on its reason. Without it
    // every `ok === false` assertion passes on a crash or a network outage too.
    return { ok: false, err: String(e.stderr ?? '') }
  }
}

/** Refused for the stated reason, not merely non-zero. */
const refuses = (result, reason) => {
  assert.equal(result.ok, false)
  assert.ok(
    result.err.includes(reason),
    `expected a refusal mentioning ${JSON.stringify(reason)}, got: ${result.err.trim()}`
  )
}
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf-8'))
const tab = (modality) => read().templates.filter((t) => t.modality === modality)
const mutate = (fn) => {
  const doc = JSON.parse(ORIGINAL)
  fn(doc, (m) => doc.templates.filter((t) => t.modality === m))
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n')
}

beforeEach(() => fs.writeFileSync(FILE, ORIGINAL))
after(() => fs.writeFileSync(FILE, ORIGINAL))

describe('the committed list is valid', () => {
  it('passes its own validator', () => {
    assert.equal(run('validate').ok, true)
  })
})

describe('per-tab composition', () => {
  const cases = [
    ['three templates', (d, t) => d.templates.splice(d.templates.indexOf(t('image')[0]), 1)],
    ['five templates', (d, t) => d.templates.push({ ...t('image')[2], id: 'extra_card' })],
    ['no recommended', (_d, t) => delete t('image').find((x) => x.recommended).recommended],
    [
      'two recommended',
      (_d, t) => (t('image').find((x) => !x.recommended && !x.apiNode).recommended = true)
    ],
    ['no paid', (_d, t) => delete t('image').find((x) => x.apiNode).apiNode],
    ['two paid', (_d, t) => (t('image').find((x) => !x.recommended && !x.apiNode).apiNode = true)],
    [
      'a paid recommended pick',
      (_d, t) => {
        const cards = t('image')
        delete cards.find((x) => x.recommended).recommended
        cards.find((x) => x.apiNode).recommended = true
      }
    ],
    [
      'a whole tab missing',
      (d) => (d.templates = d.templates.filter((x) => x.modality !== 'audio'))
    ]
  ]
  for (const [label, fn] of cases) {
    it(`rejects ${label}`, () => {
      mutate(fn)
      assert.equal(run('validate').ok, false, label)
    })
  }
})

describe('per-entry validity', () => {
  const cases = [
    ['a duplicate id', (_d, t) => (t('audio')[3].id = t('image')[3].id)],
    ['an unknown modality', (_d, t) => (t('image')[3].modality = 'gif')],
    ['an id that is not upstream', (_d, t) => (t('image')[3].id = 'ghost_template')],
    ['an id that escapes a path', (_d, t) => (t('image')[3].id = '../../etc/passwd')],
    ['an empty title', (_d, t) => (t('image')[3].snapshot.title = '')],
    ['an empty description', (_d, t) => (t('image')[3].snapshot.description = '')],
    ['a negative size', (_d, t) => (t('image')[3].snapshot.sizeBytes = -1)],
    ['a free template with no size', (_d, t) => (t('image')[3].snapshot.sizeBytes = 0)],
    [
      'a paid template with a size',
      (_d, t) => (t('image').find((x) => x.apiNode).snapshot.sizeBytes = 5)
    ],
    ['an unknown schemaVersion', (d) => (d.schemaVersion = 2)],
    ['templates not being an array', (d) => (d.templates = {})]
  ]
  for (const [label, fn] of cases) {
    it(`rejects ${label}`, () => {
      mutate(fn)
      assert.equal(run('validate').ok, false, label)
    })
  }
})

describe('the validator matches what the app reads', () => {
  it('rejects a non-boolean flag the app would read as false', () => {
    mutate((_d, t) => (t('image').find((c) => c.recommended).recommended = 'true'))
    assert.equal(run('validate').ok, false)
  })

  it('warns about a field that drifted from upstream, without failing', () => {
    // Upstream edits its own metadata, so this must not redden unrelated PRs.
    mutate((_d, t) => (t('image')[0].snapshot.title = 'Hand-edited'))
    // Exits clean: the workflow reports drift as a warning, and a hard failure
    // here would redden every open PR the moment upstream edits a description.
    assert.equal(run('validate').ok, true)
  })
})

describe('swapping a card keeps the tab whole', () => {
  it('moves the badge when the recommended pick changes', () => {
    assert.equal(
      run('set', '--modality', 'video', '--id', 'video_wan2_2_5B_ti2v', '--recommended').ok,
      true
    )
    const cards = tab('video')
    assert.equal(cards.filter((c) => c.recommended).length, 1)
    assert.equal(cards.find((c) => c.recommended).id, 'video_wan2_2_5B_ti2v')
  })

  it('refuses to auto-select a paid template', () => {
    refuses(
      run('set', '--modality', 'video', '--id', 'api_seedance2_5_r2v', '--recommended'),
      'cannot be both --recommended and paid'
    )
  })

  it('keeps exactly one paid card when the paid pick changes', () => {
    assert.equal(
      run('set', '--modality', 'image', '--id', 'api_google_nano_banana2_image_edit', '--paid').ok,
      true
    )
    assert.equal(tab('image').filter((c) => c.apiNode).length, 1)
  })

  it('treats an api_ id as paid without the flag', () => {
    assert.equal(run('set', '--modality', 'image', '--id', 'api_google_nano_banana2_image_edit').ok, true)
    const paid = tab('image').filter((c) => c.apiNode)
    assert.equal(paid.length, 1)
    assert.equal(paid[0].id, 'api_google_nano_banana2_image_edit')
  })

  it('refuses an id already in the list', () => {
    assert.equal(
      run(
        'set',
        '--modality',
        'image',
        '--id',
        'sdxlturbo_example',
        '--replaces',
        'image_pixeldit_t2i'
      ).ok,
      false
    )
  })

  it('refuses an id that belongs to another tab', () => {
    assert.equal(
      run(
        'set',
        '--modality',
        'audio',
        '--id',
        'image_z_image_turbo',
        '--replaces',
        'audio_stable_audio_example'
      ).ok,
      false
    )
  })

  it('leaves the file untouched when it refuses', () => {
    run('set', '--modality', 'video', '--id', 'ghost_id')
    assert.equal(fs.readFileSync(FILE, 'utf-8'), ORIGINAL)
  })

  it('refuses an id that belongs to a different tab upstream', () => {
    // Not already in the list, so the duplicate check cannot catch this one.
    assert.equal(
      run(
        'set',
        '--modality',
        'audio',
        '--id',
        'sdxlturbo_example',
        '--replaces',
        'audio_stable_audio_example'
      ).ok,
      false
    )
  })
})

describe('rebuilding the whole list', () => {
  const TABS = {
    video:
      '*video_minimax_h3_t2v,$api_seedance2_5_r2v,wan2.1_fun_inp,video_wan2.1_fun_camera_v1.1_1.3B',
    image:
      '*image_z_image_turbo,$api_bytedance_seedream_5_0_pro_image_edit,sdxlturbo_example,image_pixeldit_t2i',
    '3d': '*3d_triposplat_image_to_gaussian_splat,$api_tripo3_1_image_to_model,3d_moge_perspective_to_mesh,3d_hunyuan3d_multiview_to_model_turbo',
    audio:
      '*audio_stable_audio_3_medium,$api_bytedance_seed_audio1_0_t2a,audio_stable_audio_example,audio_ace_step_1_5_checkpoint'
  }
  const replace = (over = {}) => {
    const merged = { ...TABS, ...over }
    return run('replace', ...Object.entries(merged).flatMap(([k, v]) => [`--${k}`, v]))
  }

  // The picker auto-selects slot 1 and shows the paid card in slot 2, so those
  // two positions are load-bearing. The other two are free to reorder, so this
  // pins the rule, not a snapshot: a swap of slots 3 and 4 must not touch it.
  it('keeps the recommended pick first and the paid card second in every tab', () => {
    const doc = JSON.parse(ORIGINAL)
    for (const modality of MODALITIES) {
      const tab = doc.templates.filter((t) => t.modality === modality)
      assert.equal(tab.length, SLOTS, `${modality} must have ${SLOTS} slots`)
      assert.equal(tab[0].recommended, true, `${modality} slot 1 must be the recommended pick`)
      assert.equal(tab[1].apiNode, true, `${modality} slot 2 must be the paid card`)
    }
  })

  it('refuses a partial rebuild', () => {
    assert.equal(run('replace', '--video', TABS.video).ok, false)
  })

  it('refuses a tab with no paid template', () => {
    assert.equal(
      replace({
        video:
          '*video_minimax_h3_t2v,wan2.1_fun_inp,video_wan2.1_fun_camera_v1.1_1.3B,video_wan2_2_5B_ti2v'
      }).ok,
      false
    )
  })

  it('refuses a tab with no recommended template', () => {
    assert.equal(
      replace({
        video:
          'video_minimax_h3_t2v,$api_seedance2_5_r2v,wan2.1_fun_inp,video_wan2.1_fun_camera_v1.1_1.3B'
      }).ok,
      false
    )
  })

  it('refuses an id reused across tabs', () => {
    assert.equal(
      replace({
        video: '*video_minimax_h3_t2v,$api_seedance2_5_r2v,wan2.1_fun_inp,image_z_image_turbo'
      }).ok,
      false
    )
  })

  it('leaves the file untouched when it refuses', () => {
    replace({ video: '*a,b,c,d' })
    assert.equal(fs.readFileSync(FILE, 'utf-8'), ORIGINAL)
  })

  // The blank is caught either by the emptiness check or, failing that, by
  // `entryFor` refusing an unknown id. Pinned so neither guard can be dropped
  // without the other noticing.
  it('refuses an empty slot rather than silently dropping it', () => {
    assert.equal(
      replace({ video: '*video_minimax_h3_t2v,$api_seedance2_5_r2v,,wan2.1_fun_inp' }).ok,
      false
    )
  })

  it('treats an unmarked api_ id as paid', () => {
    // Without this it would be written as free and fail the zero-size rule.
    assert.equal(
      replace({
        video:
          '*video_minimax_h3_t2v,api_seedance2_5_r2v,wan2.1_fun_inp,video_wan2.1_fun_camera_v1.1_1.3B'
      }).ok,
      true
    )
    assert.equal(tab('video').filter((c) => c.apiNode).length, 1)
  })
})

describe('refreshing metadata from upstream', () => {
  it('is idempotent', () => {
    assert.equal(run('regenerate').ok, true)
    const once = fs.readFileSync(FILE, 'utf-8')
    assert.equal(run('regenerate').ok, true)
    assert.equal(fs.readFileSync(FILE, 'utf-8'), once)
  })

  it('keeps the recommended and paid picks', () => {
    assert.equal(run('regenerate').ok, true)
    for (const modality of ['video', 'image', '3d', 'audio']) {
      assert.equal(tab(modality).filter((c) => c.recommended).length, 1, modality)
      assert.equal(tab(modality).filter((c) => c.apiNode).length, 1, modality)
    }
  })

  it('restores a hand-edited field, which is what CI detects', () => {
    mutate((_d, t) => (t('video')[0].snapshot.title = 'Hand-edited'))
    assert.equal(run('regenerate').ok, true)
    assert.notEqual(tab('video')[0].snapshot.title, 'Hand-edited')
  })
})
