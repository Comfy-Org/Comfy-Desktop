/* global document, Image */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  ALL_DIRECTIONS,
  ALL_THEMES,
  list,
  OUT_ROOT,
  outDir,
  parseArgs,
  startPreview
} from './preview.mjs'

/**
 * Screenshots of the prototype in every direction × theme × milestone, and
 * an index.html to compare them side by side.
 *
 *   pnpm design:shots                         -> design-shots/latest/
 *   pnpm design:shots --name before           -> design-shots/before/
 *   pnpm design:shots --against before        -> also marks what changed
 *   --directions original,a  --themes dark  --milestones 1,2,4,10
 */
const args = parseArgs()
const name = typeof args.name === 'string' ? args.name : 'latest'
const directions = list(args.directions, ALL_DIRECTIONS)
const themes = list(args.themes, ALL_THEMES)
const milestones = list(args.milestones, ['1', '4'])
const against = typeof args.against === 'string' ? resolve(OUT_ROOT, args.against) : null

const dir = outDir(name)
const preview = await startPreview()
const shots = []

for (const direction of directions) {
  for (const theme of themes) {
    for (const milestone of milestones) {
      const file = `${direction}-${theme}-m${milestone.padStart(2, '0')}.png`
      const page = await preview.open({ direction, theme, milestone })
      await page.screenshot({ path: resolve(dir, file) })
      await page.context().close()
      shots.push({ file, direction, theme, milestone })
      process.stdout.write('.')
    }
  }
}
process.stdout.write('\n')

/** Share of pixels that differ, and an image with them painted red. */
async function compare(page, beforePath, afterPath) {
  const toData = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`
  return page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((ok) => {
          const img = new Image()
          img.onload = () => ok(img)
          img.src = src
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      const w = ib.width
      const h = ib.height
      const canvas = (img) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return ctx
      }
      const ca = canvas(ia)
      const cb = canvas(ib)
      const da = ca.getImageData(0, 0, w, h).data
      const out = cb.getImageData(0, 0, w, h)
      let changed = 0
      for (let i = 0; i < out.data.length; i += 4) {
        const d =
          Math.abs(da[i] - out.data[i]) +
          Math.abs(da[i + 1] - out.data[i + 1]) +
          Math.abs(da[i + 2] - out.data[i + 2])
        if (d > 24) {
          changed++
          out.data[i] = 255
          out.data[i + 1] = 0
          out.data[i + 2] = 64
        } else {
          out.data[i + 3] = 70
        }
      }
      cb.putImageData(out, 0, 0)
      return { ratio: changed / (w * h), png: cb.canvas.toDataURL('image/png') }
    },
    [toData(beforePath), toData(afterPath)]
  )
}

if (against) {
  const page = await preview.browser.newPage()
  for (const shot of shots) {
    const before = resolve(against, shot.file)
    if (!existsSync(before)) continue
    const { ratio, png } = await compare(page, before, resolve(dir, shot.file))
    shot.changed = ratio
    if (ratio > 0) {
      shot.diff = `diff-${shot.file}`
      writeFileSync(resolve(dir, shot.diff), Buffer.from(png.split(',')[1], 'base64'))
    }
  }
  await page.close()
}
await preview.close()

const rows = shots
  .map((s) => {
    const label = `${s.direction} · ${s.theme} · M${s.milestone}`
    const change =
      s.changed === undefined
        ? ''
        : s.changed === 0
          ? '<span class="same">unchanged</span>'
          : `<span class="changed">${(s.changed * 100).toFixed(2)}% changed</span>`
    const before = against ? `<img src="${relative(dir, resolve(against, s.file))}" />` : ''
    const diff = s.diff ? `<img src="${s.diff}" />` : ''
    return `<section><h2>${label} ${change}</h2><div class="row">${before}<img src="${s.file}" />${diff}</div></section>`
  })
  .join('\n')

writeFileSync(
  resolve(dir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Design shots: ${name}</title>
<style>
body{margin:0;padding:24px;background:#18181a;color:#eee;font:14px system-ui}
h2{font-size:14px;font-weight:600;margin:24px 0 8px}
.row{display:flex;gap:8px}.row img{width:100%;min-width:0;flex:1;border-radius:6px}
.same{color:#8a8}.changed{color:#f68}
</style>
<h1>${name}${against ? ` vs ${args.against}` : ''}</h1>
${rows}`
)

const changed = shots.filter((s) => s.changed > 0)
console.log(`${shots.length} screenshots in ${relative(process.cwd(), dir)}/ (open index.html)`)
if (against) console.log(`${changed.length} changed vs ${args.against}`)
