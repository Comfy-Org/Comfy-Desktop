#!/usr/bin/env node
/**
 * Generate and validate `assets/starter-templates.json`, the starter-template
 * list desktop reads from R2 at boot.
 *
 * Editors supply template ids only. Every display field is derived from the
 * live `comfyui_workflow_templates` index, so a description can never drift
 * from the template it describes.
 *
 *   node scripts/starter-templates.mjs validate
 *   node scripts/starter-templates.mjs regenerate
 *   node scripts/starter-templates.mjs set --modality video --id <template_id> [--recommended|--paid]
 *   node scripts/starter-templates.mjs list --modality video [--free|--paid]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'starter-templates.json')
const INDEX_URL =
  'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/index.json'

const SCHEMA_VERSION = 1
const SLOTS = 4
const MODALITIES = ['video', 'image', '3d', 'audio']
/** Mirrors the app's own id validator: this reaches a URL and a file path. */
const ID = /^[a-zA-Z0-9_.-]+$/
/** Subtypes whose `<id>-1.<sub>` preview is a real image; audio renders a glyph. */
const IMAGE_SUBTYPES = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'])

const die = (msg) => {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

async function liveIndex() {
  const res = await fetch(INDEX_URL)
  if (!res.ok) die(`could not read the template index (HTTP ${res.status})`)
  const categories = await res.json()
  const byId = new Map()
  for (const category of categories) {
    const modality = MODALITIES.includes(category.type) ? category.type : null
    for (const entry of category.templates ?? []) {
      if (!byId.has(entry.name)) byId.set(entry.name, { ...entry, modality })
    }
  }
  return byId
}

/** An entry as the app expects it, with every display field taken from upstream. */
function entryFor(id, modality, index, flags = {}) {
  const live = index.get(id)
  if (!live) die(`"${id}" is not in the template index — check the id at ${INDEX_URL}`)
  if (!ID.test(id)) die(`"${id}" is not a valid template id`)

  const paid = flags.paid ?? id.startsWith('api_')
  const size = typeof live.size === 'number' && live.size > 0 ? live.size : 0
  if (!paid && size === 0) {
    die(`"${id}" reports no download size upstream, so the disk-space check cannot size it`)
  }
  return {
    id,
    modality,
    ...(flags.recommended ? { recommended: true } : {}),
    ...(paid ? { apiNode: true } : {}),
    snapshot: {
      title: live.title ?? id,
      description: live.description ?? '',
      sizeBytes: paid ? 0 : size,
      mediaSubtype: live.mediaSubtype ?? 'webp'
    }
  }
}

/**
 * The rules the picker cannot enforce for us. A violation here is silent in the
 * app: a short tab just backfills, and a paid auto-pick spends credits on the
 * user's first run.
 */
function check(doc) {
  const errors = []
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`)
  if (!Array.isArray(doc.templates)) return ['templates must be an array']

  const seen = new Set()
  for (const t of doc.templates) {
    if (seen.has(t.id)) errors.push(`duplicate id "${t.id}" — ids are the picker's option key`)
    seen.add(t.id)
    if (!ID.test(t.id ?? '')) errors.push(`invalid id "${t.id}"`)
    if (!MODALITIES.includes(t.modality)) errors.push(`"${t.id}" has unknown modality`)
    const s = t.snapshot ?? {}
    if (!s.title?.trim()) errors.push(`"${t.id}" has no title`)
    if (!s.description?.trim()) errors.push(`"${t.id}" has no description`)
    if (!Number.isInteger(s.sizeBytes) || s.sizeBytes < 0) {
      errors.push(`"${t.id}" has an invalid sizeBytes`)
    } else if (!t.apiNode && s.sizeBytes === 0) {
      errors.push(`"${t.id}" is free but reports no size — the disk-space check would under-count`)
    } else if (t.apiNode && s.sizeBytes !== 0) {
      errors.push(`"${t.id}" is paid, so it downloads nothing and must report 0 bytes`)
    }
    if (t.apiNode && t.recommended) errors.push(`"${t.id}" cannot be both paid and recommended`)
  }

  for (const modality of MODALITIES) {
    const tab = doc.templates.filter((t) => t.modality === modality)
    if (tab.length !== SLOTS) {
      errors.push(`${modality}: needs exactly ${SLOTS} templates, found ${tab.length}`)
    }
    const paid = tab.filter((t) => t.apiNode)
    if (paid.length !== 1) {
      errors.push(
        `${modality}: needs exactly 1 paid template, found ${paid.length} ` +
          `(one showcases API nodes; more than one breaks the open-source balance)`
      )
    }
    const rec = tab.filter((t) => t.recommended)
    if (rec.length !== 1) {
      errors.push(`${modality}: needs exactly 1 recommended template, found ${rec.length}`)
    }
    if (rec[0]?.apiNode) {
      errors.push(`${modality}: the recommended pick is paid and would spend credits on first run`)
    }
  }
  return errors
}

function read() {
  if (!fs.existsSync(OUT)) die(`${path.relative(ROOT, OUT)} does not exist — run regenerate first`)
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf-8'))
  } catch (e) {
    die(`${path.relative(ROOT, OUT)} is not valid JSON: ${e.message}`)
  }
}

function write(doc) {
  const errors = check(doc)
  if (errors.length) {
    console.error('\n  Refusing to write — this would break the picker:\n')
    for (const e of errors) console.error(`    ✗ ${e}`)
    console.error('')
    process.exit(1)
  }
  // Tab order first, so the file reads in the order the picker renders.
  doc.templates.sort(
    (a, b) => MODALITIES.indexOf(a.modality) - MODALITIES.indexOf(b.modality)
  )
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n')
}

function summarise(doc) {
  for (const modality of MODALITIES) {
    console.log(`\n  ${modality}`)
    for (const t of doc.templates.filter((x) => x.modality === modality)) {
      const tag = t.recommended ? ' ← recommended' : t.apiNode ? ' (paid)' : ''
      console.log(`    ${t.snapshot.title}${tag}`)
      console.log(`      ${t.id}`)
    }
  }
  console.log('')
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)

const commands = {
  async validate() {
    const doc = read()
    const errors = check(doc)
    const index = await liveIndex()
    for (const t of doc.templates) {
      if (!index.has(t.id)) {
        errors.push(`"${t.id}" is no longer in the template index — it would render a dead card`)
      }
    }
    if (errors.length) {
      console.error('\n  Invalid starter-templates.json:\n')
      for (const e of errors) console.error(`    ✗ ${e}`)
      console.error('')
      process.exit(1)
    }
    console.log(`\n  ✓ ${doc.templates.length} templates, ${SLOTS} per tab, rules hold\n`)
  },

  /** Rebuild every display field from the live index, keeping the same ids. */
  async regenerate() {
    const index = await liveIndex()
    const doc = read()
    doc.templates = doc.templates.map((t) =>
      entryFor(t.id, t.modality, index, { recommended: !!t.recommended, paid: !!t.apiNode })
    )
    write(doc)
    console.log(`\n  ✓ refreshed titles, descriptions and sizes from upstream`)
    summarise(doc)
  },

  /** Swap one slot. The id is all an editor should ever need to supply. */
  async set() {
    const modality = arg('modality')
    const id = arg('id')
    const replaces = arg('replaces')
    if (!MODALITIES.includes(modality)) die(`--modality must be one of ${MODALITIES.join(', ')}`)
    if (!id) die('--id is required')

    const index = await liveIndex()
    const doc = read()
    const tab = doc.templates.filter((t) => t.modality === modality)
    const recommended = flag('recommended')
    const paid = flag('paid') || id.startsWith('api_')

    // Replace like for like, so the tab keeps its shape without the editor
    // having to reason about counts.
    const target = replaces
      ? tab.find((t) => t.id === replaces)
      : recommended
        ? tab.find((t) => t.recommended)
        : paid
          ? tab.find((t) => t.apiNode)
          : tab.find((t) => !t.recommended && !t.apiNode)
    if (!target) die(`nothing to replace in ${modality} — pass --replaces <id>`)

    const next = entryFor(id, modality, index, { recommended, paid })
    doc.templates = doc.templates.map((t) => (t.id === target.id ? next : t))
    write(doc)
    console.log(`\n  ✓ ${modality}: ${target.id} → ${id}`)
    summarise(doc)
  },

  /**
   * Rebuild the whole list from a set of ids — a seasonal refresh, rather than
   * a one-slot swap. Ids are given per tab; everything else is derived.
   *
   *   --video a,b,c,d --image a,b,c,d --3d a,b,c,d --audio a,b,c,d
   *
   * Mark the auto-pick with `*` and a paid card with `$`:
   *   --video "*wan_t2v,$api_seedance,wan_inp,wan_cam"
   */
  async replace() {
    const index = await liveIndex()
    const templates = []
    for (const modality of MODALITIES) {
      const raw = arg(modality)
      if (!raw) die(`--${modality} is required — give ${SLOTS} ids, comma-separated`)
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length !== SLOTS) {
        die(`--${modality} needs exactly ${SLOTS} ids, got ${ids.length}`)
      }
      for (const marked of ids) {
        const recommended = marked.startsWith('*')
        const paid = marked.startsWith('$')
        const id = marked.replace(/^[*$]/, '')
        templates.push(entryFor(id, modality, index, { recommended, paid }))
      }
    }
    write({ schemaVersion: SCHEMA_VERSION, templates })
    console.log(`\n  ✓ rebuilt the whole list`)
    summarise({ templates })
  },

  /** Browse what upstream offers, so an editor can find an id without guessing. */
  async list() {
    const modality = arg('modality')
    if (!MODALITIES.includes(modality)) die(`--modality must be one of ${MODALITIES.join(', ')}`)
    const index = await liveIndex()
    const wantPaid = flag('paid')
    const wantFree = flag('free')
    const rows = [...index.values()].filter((t) => {
      if (t.modality !== modality) return false
      const paid = t.name.startsWith('api_')
      if (wantPaid && !paid) return false
      if (wantFree && paid) return false
      return true
    })
    console.log(`\n  ${rows.length} ${modality} templates upstream\n`)
    for (const t of rows) {
      const gb = t.size > 0 ? ` · ${(t.size / 1e9).toFixed(1)} GB` : ''
      console.log(`    ${t.name}`)
      console.log(`      ${t.title ?? ''}${t.name.startsWith('api_') ? ' (paid)' : gb}`)
    }
    console.log('')
  }
}

const command = process.argv[2]
if (!commands[command]) {
  console.error(`\n  usage: node scripts/starter-templates.mjs <${Object.keys(commands).join('|')}>\n`)
  process.exit(1)
}
await commands[command]()
