#!/usr/bin/env node
/**
 * Generate and validate `assets/benchmark-templates.json`, the example workflows
 * the performance test page offers. The list mirrors the API-format prompts in
 * the workflow_templates repo's `benchmarks/` folder; every display field comes
 * from `templates/index.json`, so nothing is hand-edited.
 *
 *   node scripts/benchmark-templates.mjs validate
 *   node scripts/benchmark-templates.mjs regenerate [--source <workflow_templates checkout>]
 *
 * `validate` checks the file's shape and that every example can actually be
 * downloaded from GitHub `main`: its `benchmarks/<id>.json` prompt and its parent
 * `templates/<id>.json` editor workflow. `regenerate` rebuilds the list from
 * GitHub `main`, or from a local checkout with `--source` (then run `validate`
 * to see what is not published yet).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'benchmark-templates.json')
const REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main'
const LISTING_URL = 'https://api.github.com/repos/Comfy-Org/workflow_templates/contents/benchmarks'
const SCHEMA_VERSION = 1
const MODALITIES = ['video', 'image', '3d', 'audio']
/** Mirrors the app's id validator: an id reaches a URL and a file path. */
const ID = /^[a-zA-Z0-9_.-]+$/
const RESERVED_IDS = new Set(['.', '..', 'none'])

const die = (message) => {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

async function fetchOk(url, init) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), ...init })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response
}

function isApiPrompt(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every(
      (node) =>
        typeof node?.class_type === 'string' &&
        node.inputs !== null &&
        typeof node.inputs === 'object'
    )
  )
}

/** Source of the benchmark ids, their prompts and the template index. */
function repoSource(sourceDir) {
  if (sourceDir) {
    const read = (...parts) => JSON.parse(fs.readFileSync(path.join(sourceDir, ...parts), 'utf8'))
    return {
      label: sourceDir,
      listIds: async () =>
        fs
          .readdirSync(path.join(sourceDir, 'benchmarks'))
          .filter((name) => name.endsWith('.json'))
          .map((name) => name.slice(0, -'.json'.length)),
      index: async () => read('templates', 'index.json'),
      prompt: async (id) => read('benchmarks', `${id}.json`),
      hasTemplate: async (id) => fs.existsSync(path.join(sourceDir, 'templates', `${id}.json`))
    }
  }
  return {
    label: 'GitHub main',
    listIds: async () => {
      const listing = await (await fetchOk(LISTING_URL)).json()
      return listing
        .filter((file) => file.type === 'file' && file.name.endsWith('.json'))
        .map((file) => file.name.slice(0, -'.json'.length))
    },
    index: async () => (await fetchOk(`${REPO}/templates/index.json`)).json(),
    prompt: async (id) =>
      (await fetchOk(`${REPO}/benchmarks/${encodeURIComponent(id)}.json`)).json(),
    hasTemplate: async (id) =>
      (await fetch(`${REPO}/templates/${encodeURIComponent(id)}.json`, { method: 'HEAD' })).ok
  }
}

function indexById(categories) {
  const byId = new Map()
  for (const category of categories) {
    for (const entry of category.templates ?? []) {
      if (!byId.has(entry.name)) byId.set(entry.name, { ...entry, modality: category.type })
    }
  }
  return byId
}

/** Shape errors the app would silently drop the entry for. */
function shapeErrors(doc) {
  if (doc?.schemaVersion !== SCHEMA_VERSION) return [`schemaVersion must be ${SCHEMA_VERSION}`]
  if (!Array.isArray(doc.templates)) return ['templates must be an array']
  const errors = []
  const seen = new Set()
  for (const entry of doc.templates) {
    const id = entry?.id
    if (typeof id !== 'string' || !ID.test(id) || RESERVED_IDS.has(id)) {
      errors.push(`invalid id ${JSON.stringify(id)}`)
      continue
    }
    if (seen.has(id)) errors.push(`duplicate id "${id}"`)
    seen.add(id)
    if (!MODALITIES.includes(entry.modality)) errors.push(`"${id}" has unknown modality`)
    if (entry.recommended !== undefined && typeof entry.recommended !== 'boolean') {
      errors.push(`"${id}" has a non-boolean recommended flag`)
    }
    const s = entry.snapshot ?? {}
    for (const field of ['title', 'description', 'mediaSubtype']) {
      if (typeof s[field] !== 'string' || !s[field].trim()) errors.push(`"${id}" has no ${field}`)
    }
    if (!Number.isInteger(s.sizeBytes) || s.sizeBytes <= 0) {
      errors.push(`"${id}" needs a positive sizeBytes for the disk-space check`)
    }
  }
  return errors
}

async function regenerate(sourceDir) {
  const source = repoSource(sourceDir)
  const ids = await source.listIds()
  const byId = indexById(await source.index())
  const problems = []
  const templates = []
  for (const id of ids) {
    const live = byId.get(id)
    if (!live) {
      problems.push(`${id}: not in templates/index.json`)
      continue
    }
    if (!MODALITIES.includes(live.modality)) problems.push(`${id}: modality "${live.modality}"`)
    if (!(live.size > 0)) problems.push(`${id}: no size in templates/index.json`)
    if (!(await source.hasTemplate(id))) problems.push(`${id}: no templates/${id}.json`)
    const prompt = await source.prompt(id).catch(() => null)
    if (!prompt) problems.push(`${id}: benchmarks/${id}.json could not be read`)
    else if (!isApiPrompt(prompt)) problems.push(`${id}: benchmark is not API format`)
    templates.push({
      id,
      modality: live.modality,
      snapshot: {
        title: live.title ?? id,
        description: live.description ?? '',
        sizeBytes: live.size,
        mediaSubtype: live.mediaSubtype ?? 'webp'
      }
    })
  }
  if (problems.length) die(`not writing, from ${source.label}:\n    ${problems.join('\n    ')}`)
  templates.sort((a, b) => MODALITIES.indexOf(a.modality) - MODALITIES.indexOf(b.modality))
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, templates }, null, 2)}\n`
  )
  console.log(`  ✓ wrote ${templates.length} examples from ${source.label}`)
}

async function validate() {
  const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const errors = shapeErrors(doc)
  if (errors.length) die(`${path.relative(ROOT, OUT)}:\n    ${errors.join('\n    ')}`)
  const source = repoSource(null)
  const unpublished = []
  for (const { id } of doc.templates) {
    const [hasTemplate, prompt] = await Promise.all([
      source.hasTemplate(id),
      source.prompt(id).catch(() => null)
    ])
    if (!hasTemplate) unpublished.push(`${id}: templates/${id}.json is not on GitHub main`)
    if (!prompt) unpublished.push(`${id}: benchmarks/${id}.json is not on GitHub main`)
    else if (!isApiPrompt(prompt))
      unpublished.push(`${id}: benchmarks/${id}.json is not API format`)
  }
  if (unpublished.length) {
    die(`users could not download these examples:\n    ${unpublished.join('\n    ')}`)
  }
  console.log(`  ✓ ${doc.templates.length} examples, all downloadable from GitHub main`)
}

const [command, ...args] = process.argv.slice(2)
const sourceFlag = args.indexOf('--source')
if (command === 'validate') await validate()
else if (command === 'regenerate') await regenerate(sourceFlag >= 0 ? args[sourceFlag + 1] : null)
else die('usage: benchmark-templates.mjs validate | regenerate [--source <dir>]')
