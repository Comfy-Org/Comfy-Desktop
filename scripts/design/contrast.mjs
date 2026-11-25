/* global document, getComputedStyle */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_DIRECTIONS, ALL_THEMES, list, outDir, parseArgs, startPreview } from './preview.mjs'

/**
 * WCAG contrast of every text role on every surface, per direction × theme,
 * read from the live tokens (so color-mix and alpha are resolved the way the
 * browser paints them).
 *
 *   pnpm design:contrast                     -> table + design-shots/contrast.md
 *   --directions original,a  --themes light  --strict (exit 1 on a failure)
 */
const args = parseArgs()
const directions = list(args.directions, ALL_DIRECTIONS)
const themes = list(args.themes, ALL_THEMES)

const MIN_TEXT = 4.5

/** [text token, surface tokens from bottom to top] */
const PAIRS = [
  ...['base-foreground', 'muted-foreground', 'subtle-foreground'].flatMap((text) => [
    [text, ['app-background']],
    [text, ['content-background']],
    [text, ['content-background', 'card-background']],
    [text, ['content-background', 'card-background-hover']],
    [text, ['content-background', 'secondary-background']]
  ]),
  ['inverted-foreground', ['content-background', 'inverted-background']],
  ['status-danger', ['content-background']],
  ['status-running', ['content-background', 'card-background']]
]

const preview = await startPreview()
const results = []

for (const direction of directions) {
  for (const theme of themes) {
    const page = await preview.open({ direction, theme, milestone: 1 })
    const ratios = await page.evaluate((pairs) => {
      const probe = document.createElement('div')
      document.body.append(probe)
      const resolveColor = (token) => {
        probe.style.backgroundColor = `var(--color-${token})`
        return getComputedStyle(probe).backgroundColor
      }
      const ctx = Object.assign(document.createElement('canvas'), {
        width: 1,
        height: 1
      }).getContext('2d', { colorSpace: 'srgb' })
      const paint = (layers) => {
        ctx.clearRect(0, 0, 1, 1)
        for (const color of layers) {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
        }
        return ctx.getImageData(0, 0, 1, 1).data
      }
      const luminance = ([r, g, b]) => {
        const lin = (c) => {
          const s = c / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      }
      const out = pairs.map(([text, surfaces]) => {
        const under = surfaces.map(resolveColor)
        const bg = luminance(paint(['#000', ...under]))
        const bgWhite = luminance(paint(['#fff', ...under]))
        const fg = luminance(paint(['#000', ...under, resolveColor(text)]))
        const [hi, lo] = [Math.max(fg, bg), Math.min(fg, bg)]
        return {
          text,
          surface: surfaces.at(-1),
          ratio: (hi + 0.05) / (lo + 0.05),
          opaque: Math.abs(bg - bgWhite) < 0.001
        }
      })
      probe.remove()
      return out
    }, PAIRS)
    await page.context().close()
    for (const r of ratios) results.push({ direction, theme, ...r })
  }
}
await preview.close()

const fails = results.filter((r) => r.ratio < MIN_TEXT)
const lines = [
  `| Direction | Theme | Text | Surface | Contrast | AA (${MIN_TEXT}:1) |`,
  '| --- | --- | --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| ${r.direction} | ${r.theme} | ${r.text} | ${r.surface}${r.opaque ? '' : ' (see-through)'} | ${r.ratio.toFixed(2)} | ${r.ratio >= MIN_TEXT ? 'pass' : '**fail**'} |`
  )
]
const report = lines.join('\n')
writeFileSync(resolve(outDir(), 'contrast.md'), `# Contrast\n\n${report}\n`)
console.log(report)
console.log(`\n${fails.length} of ${results.length} pairs below ${MIN_TEXT}:1`)
if (args.strict && fails.length) process.exit(1)
