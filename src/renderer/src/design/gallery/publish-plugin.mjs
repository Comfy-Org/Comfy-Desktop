// Dev-server endpoints for the design gallery's "Publish" and "Revert".
// Token values and swaps write only to the landing kit (tokens.css, cva
// variant files, kit components). Merges rewrite every use in landing/ and
// in this gallery, which consumes the kit too. Each file is backed up the
// first time it is written so "Revert" can restore the original. Register it in the preview Vite config:
//   import galleryPublish from '<this file>'; plugins: [galleryPublish()]
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { namespaceOf } from './theme.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const LANDING = resolve(HERE, '../landing')
const UI = join(LANDING, 'ui')
const BACKUP = resolve(HERE, '../../../../../node_modules/.cache/design-gallery/originals')
// tokens.css, the cva variant files, and any kit component file.
const allowed = (file) =>
  file === 'tokens.css' ||
  /^[a-z]+\.variants\.ts$/.test(file) ||
  (/^[A-Z][A-Za-z]+\.vue$/.test(file) && existsSync(join(UI, file)))
// After our own writes, reload pages fully instead of hot-patching the
// half-updated kit modules (which logs Vue patch errors mid-update).
let suppressUntil = 0
const quietReload = () => (suppressUntil = Date.now() + 3000)

const TOKEN_NAME = /^[a-z0-9-]+$/
const TOKEN_VALUE = /^[^;{}]+$/
const CLASS = /^[\w:\-[\]/.()=%#!]+$/

// Paths are landing-relative; gallery files are prefixed with GALLERY.
const GALLERY = '@gallery/'
export const abs = (rel) =>
  rel.startsWith(GALLERY) ? join(HERE, rel.slice(GALLERY.length)) : join(LANDING, rel)

/** Back up a file the first time it is written. */
export async function backup(rel) {
  const dest = join(BACKUP, rel)
  if (existsSync(dest)) return
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(abs(rel), dest)
}

async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (/\.(vue|ts|css)$/.test(e.name)) out.push(p)
  }
  return out
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
// Namespaces and their utilities come from the gallery's theme.ts, so
// merges work for any Tailwind v4 token group.
const groupOf = (name) => namespaceOf(name).id
const shortOf = (name) => name.slice(namespaceOf(name).prefix.length) || name

/** Rewrite every use of token `from` to `to` in one source string. */
export function mergeIn(src, from, to) {
  const utilities = namespaceOf(from).utilities
  let out = src
  if (utilities.length) {
    const a = esc(shortOf(from))
    const util = new RegExp(
      `(?<![\\w-])((?:[\\w\\-\\[\\]=:&>*]+:)?!?(?:${utilities.join('|')})-)${a}(?![\\w-])`,
      'g'
    )
    out = out.replace(util, `$1${shortOf(to)}`)
  }
  out = out.replaceAll(`var(--${from}--line-height)`, `var(--${to}--line-height)`)
  out = out.replaceAll(`var(--${from})`, `var(--${to})`)
  return out
}

/** Remove `name` from cn.ts's `list: [...]`, wherever it sits in it. */
export function dropFromList(src, list, name) {
  return src.replace(new RegExp(`${list}: \\[[^\\]]*\\]`), (arr) =>
    arr
      .replace(new RegExp(`'${esc(name)}',\\s*`), '')
      .replace(new RegExp(`,\\s*'${esc(name)}'(?=\\])`), '')
  )
}

/** Index range of the block opened at `from` ({ or [). */
function blockEnd(src, from) {
  const open = src[from]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close && --depth === 0) return i
  }
  return -1
}

/** Replace class `from` with `to` inside a string literal of a region. */
function swapIn(region, from, to) {
  let hits = 0
  const out = region.replace(/'([^']*)'/g, (_m, s) => {
    const next = s
      .split(/(\s+)/)
      .map((w) => (w === from ? (hits++, to) : w))
      .join('')
    return `'${next}'`
  })
  return { out, hits }
}

/** Replace a class that appears exactly once in the file's quoted strings. */
function swapOnce(src, from, to) {
  let hits = 0
  const out = src.replace(/(['"])([^'"\n]*)\1/g, (m, q, body) => {
    if (!body.split(/\s+/).includes(from)) return m
    hits++
    return (
      q +
      body
        .split(/(\s+)/)
        .map((w) => (w === from ? to : w))
        .join('') +
      q
    )
  })
  if (hits !== 1) throw new Error(`"${from}" appears ${hits} times; can't tell which to change`)
  return out
}

function applySwap(src, { axis, option, from, to }) {
  if (axis === 'file') return swapOnce(src, from, to)
  const cva = src.indexOf('cva(')
  if (cva < 0) throw new Error('No cva() definition found')
  if (axis === 'base') {
    const at = src.indexOf('base:', cva)
    if (at < 0) throw new Error('No base classes found')
    let start = at + 5
    while (/\s/.test(src[start])) start++
    const end = src[start] === '[' ? blockEnd(src, start) + 1 : src.indexOf("'", start + 1) + 1
    const { out, hits } = swapIn(src.slice(start, end), from, to)
    if (!hits) throw new Error(`"${from}" not found in base`)
    return src.slice(0, start) + out + src.slice(end)
  }
  const vAt = src.indexOf('variants:', cva)
  const vOpen = src.indexOf('{', vAt)
  const vEnd = blockEnd(src, vOpen)
  const axisRe = new RegExp(`\\b${axis}:\\s*\\{`, 'g')
  axisRe.lastIndex = vOpen + 1
  const am = axisRe.exec(src)
  if (!am || am.index > vEnd) throw new Error(`Axis "${axis}" not found`)
  const aOpen = am.index + am[0].length - 1
  const aEnd = blockEnd(src, aOpen)
  const optRe = new RegExp(`(['"]?${option.replace(/[-]/g, '\\-')}['"]?\\s*:\\s*)'([^']*)'`)
  const axisBody = src.slice(aOpen, aEnd)
  const om = optRe.exec(axisBody)
  if (!om) throw new Error(`Option "${option}" not found in ${axis}`)
  const oStart = aOpen + om.index + om[1].length
  const oEnd = oStart + om[2].length + 2
  const { out, hits } = swapIn(src.slice(oStart, oEnd), from, to)
  if (!hits) throw new Error(`"${from}" not found in ${axis}.${option}`)
  return src.slice(0, oStart) + out + src.slice(oEnd)
}

async function body(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw || '{}')
}

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}

async function listBackups(dir = BACKUP) {
  if (!existsSync(dir)) return []
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listBackups(p)))
    else out.push(relative(BACKUP, p))
  }
  return out
}

async function publish({ tokens = {}, swaps = [], merges = [] }) {
  const edits = new Map() // landing-relative path -> source
  const load = async (rel) => {
    if (!edits.has(rel)) edits.set(rel, await readFile(abs(rel), 'utf8'))
    return edits.get(rel)
  }
  // Token values and swaps only touch the kit (ui/).
  const read = async (file) => {
    if (!allowed(file)) throw new Error(`Not allowed: ${file}`)
    return load(`ui/${file}`)
  }

  if (Object.keys(tokens).length) {
    let css = await read('tokens.css')
    for (const [name, value] of Object.entries(tokens)) {
      if (!TOKEN_NAME.test(name) || !TOKEN_VALUE.test(String(value)))
        throw new Error(`Invalid token ${name}`)
      const re = new RegExp(`(--${name}:\\s*)([^;]+)(;)`)
      if (!re.test(css)) throw new Error(`Token --${name} not found in tokens.css`)
      css = css.replace(re, `$1${String(value).trim()}$3`)
    }
    edits.set('ui/tokens.css', css)
  }

  for (const s of swaps) {
    if (!CLASS.test(s.from) || !CLASS.test(s.to))
      throw new Error(`Invalid class ${s.from} -> ${s.to}`)
    edits.set(`ui/${s.file}`, applySwap(await read(s.file), s))
  }

  // Merges: rewrite every use across landing/ and the gallery, then delete
  // the token.
  if (merges.length) {
    for (const m of merges)
      if (!TOKEN_NAME.test(m.from) || !TOKEN_NAME.test(m.to) || !groupOf(m.from))
        throw new Error(`Invalid merge ${m.from} -> ${m.to}`)
    const files = [
      ...(await walk(LANDING)).map((f) => relative(LANDING, f)),
      ...(await walk(HERE)).map((f) => GALLERY + relative(HERE, f))
    ]
    for (const rel of files) {
      if (rel === 'ui/tokens.css') continue
      const src = await load(rel)
      let next = src
      for (const m of merges) next = mergeIn(next, m.from, m.to)
      // cn.ts lists text/radius/shadow/blur scales (never colors): drop the
      // merged name from its own group's list only.
      if (rel === 'ui/cn.ts')
        for (const m of merges) {
          // tailwind-merge theme keys match the namespace ids.
          next = dropFromList(next, groupOf(m.from), shortOf(m.from))
        }
      if (next === src) edits.delete(rel)
      else edits.set(rel, next)
    }
    let css = await load('ui/tokens.css')
    for (const m of merges) {
      css = css.replace(
        new RegExp(`^[ \\t]*--${esc(m.from)}(?:--line-height)?:[^;]+;[^\\n]*\\n`, 'gm'),
        ''
      )
    }
    edits.set('ui/tokens.css', css)
  }

  quietReload()
  for (const [rel, src] of edits) {
    await backup(rel)
    await writeFile(abs(rel), src)
  }
  return [...edits.keys()]
}

async function restore() {
  const files = await listBackups()
  quietReload()
  for (const f of files) await copyFile(join(BACKUP, f), abs(f))
  await rm(BACKUP, { recursive: true, force: true })
  return files
}

export default function galleryPublish() {
  return {
    name: 'design-gallery-publish',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (Date.now() > suppressUntil || !(file.startsWith(LANDING) || file.startsWith(HERE))) return
      server.ws.send({ type: 'full-reload' })
      return []
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__gallery/')) return next()
        try {
          if (req.url === '/__gallery/status')
            return send(res, 200, { backedUp: await listBackups() })
          if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
          if (req.url === '/__gallery/publish')
            return send(res, 200, { written: await publish(await body(req)) })
          if (req.url === '/__gallery/restore') return send(res, 200, { restored: await restore() })
          return send(res, 404, { error: 'Unknown endpoint' })
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    }
  }
}
