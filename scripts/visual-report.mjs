import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  )

async function screenshots(directory) {
  try {
    return (await readdir(directory, { recursive: true }))
      .filter((name) => name.endsWith('.png'))
      .map((name) => name.replaceAll('\\', '/'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function statusOfUnpairedScene(capturedByBase, runs) {
  if (capturedByBase) return runs.head === 0 ? 'removed' : 'not compared'
  return runs.base === 0 ? 'added' : 'not compared'
}

export async function compareScreenshots(reportDir, runs = { base: 0, head: 0 }) {
  const baseDir = join(reportDir, 'base/screenshots')
  const headDir = join(reportDir, 'head/screenshots')
  const baseNames = new Set(await screenshots(baseDir))
  const headNames = new Set(await screenshots(headDir))
  const entries = []
  for (const name of [...new Set([...baseNames, ...headNames])].sort()) {
    const entry = {
      name,
      base: baseNames.has(name) ? `base/screenshots/${name}` : null,
      head: headNames.has(name) ? `head/screenshots/${name}` : null,
      status: statusOfUnpairedScene(baseNames.has(name), runs)
    }
    if (entry.base && entry.head) {
      const base = PNG.sync.read(await readFile(join(baseDir, name)))
      const head = PNG.sync.read(await readFile(join(headDir, name)))
      const width = Math.max(base.width, head.width)
      const height = Math.max(base.height, head.height)
      const before = new PNG({ width, height })
      const after = new PNG({ width, height })
      PNG.bitblt(base, before, 0, 0, base.width, base.height, 0, 0)
      PNG.bitblt(head, after, 0, 0, head.width, head.height, 0, 0)
      const diff = new PNG({ width, height })
      entry.changedPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
        threshold: 0,
        includeAA: true
      })
      entry.baseSize = `${base.width} × ${base.height}`
      entry.headSize = `${head.width} × ${head.height}`
      entry.status =
        entry.changedPixels || entry.baseSize !== entry.headSize ? 'changed' : 'unchanged'
      if (entry.status === 'changed') {
        entry.diff = `diff/${name}`
        await mkdir(join(reportDir, 'diff', name, '..'), { recursive: true })
        await writeFile(join(reportDir, entry.diff), PNG.sync.write(diff))
      }
    }
    entries.push(entry)
  }
  return entries
}

export async function writeReport(reportDir, metadata, runs) {
  const complete = !metadata.error && runs.base === 0 && runs.head === 0
  const rendered = !metadata.error && runs.base !== null && runs.head !== null
  const passed = !metadata.error && runs.head === 0
  const entries = rendered ? await compareScreenshots(reportDir, runs) : []
  if (passed && !entries.some((entry) => entry.head))
    throw new Error('No screenshots were captured for the comparison.')
  const counts = Object.fromEntries(
    ['changed', 'unchanged', 'added', 'removed', 'not compared'].map((status) => [
      status,
      entries.filter((entry) => entry.status === status).length
    ])
  )
  const countSummary = `${counts.changed} changed · ${counts.unchanged} unchanged · ${counts.added} added · ${counts.removed} removed`
  const failedRenders = [runs.base !== 0 && 'Base', runs.head !== 0 && 'PR'].filter(Boolean)
  const summary = complete
    ? countSummary
    : rendered
      ? `${failedRenders.join(' and ')} render failed — see the render logs. ${countSummary} · ${counts['not compared']} not compared`
      : 'Comparison incomplete — see the render logs. No visual conclusion is available.'
  const result = { complete, passed, summary, ...metadata, runs, counts, entries }
  const image = (path, label) =>
    path
      ? `<figure><figcaption>${label}</figcaption><a href="${path.split('/').map(encodeURIComponent).join('/')}"><img loading="lazy" src="${path.split('/').map(encodeURIComponent).join('/')}" alt="${label}"></a></figure>`
      : `<figure><figcaption>${label}</figcaption><p>No image</p></figure>`
  const cards = [...entries]
    .sort((a, b) => Number(a.status === 'unchanged') - Number(b.status === 'unchanged'))
    .map(
      (entry) => `<details ${entry.status === 'unchanged' ? '' : 'open'}>
      <summary><strong>${escapeHtml(entry.name)}</strong> <span>${entry.status}${entry.changedPixels === undefined ? '' : ` · ${entry.changedPixels.toLocaleString('en-US')} changed pixels`}</span></summary>
      ${entry.baseSize ? `<p>${entry.baseSize} → ${entry.headSize}</p>` : ''}
      <div class="images">${image(entry.base, 'Base')}${image(entry.head, 'PR / working tree')}${entry.diff ? image(entry.diff, 'Difference') : ''}</div>
    </details>`
    )
    .join('\n')
  await mkdir(reportDir, { recursive: true })
  await writeFile(join(reportDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(
    join(reportDir, 'index.html'),
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desktop visual comparison</title>
<style>
  :root { font-family: system-ui, sans-serif; color: #e8e8ec; background: #15161a; color-scheme: dark; }
  body { max-width: 1800px; margin: auto; padding: 32px; }
  h1 { margin-bottom: 8px; } a { color: #aabfff; } p { color: #bec0cb; line-height: 1.5; }
  code { overflow-wrap: anywhere; } .status { padding: 16px; background: #252833; border-radius: 8px; }
  details { margin: 20px 0; padding: 16px; background: #1e2027; border: 1px solid #383b48; border-radius: 8px; }
  summary { cursor: pointer; overflow-wrap: anywhere; } summary span { margin-left: 12px; color: #bec0cb; }
  .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  figure { min-width: 0; margin: 16px 0 0; } figcaption { margin-bottom: 8px; font-weight: 600; }
  img { width: 100%; height: auto; border: 1px solid #383b48; } @media (max-width: 600px) { body { padding: 16px; } .images { grid-template-columns: 1fr; } }
</style>
<h1>Desktop visual comparison</h1>
<p>Base <code>${escapeHtml(metadata.baseRef)}</code>, branched from <code>${escapeHtml(metadata.baseSha)}</code><br>
PR <code>${escapeHtml(metadata.headSha)}</code>${metadata.workingTreeChanges ? ' + local tracked changes' : ''}<br>
Both rendered on ${escapeHtml(metadata.platform)} with Playwright ${escapeHtml(metadata.playwright)}.</p>
<p class="status">${summary}</p>
${metadata.error ? `<p>${escapeHtml(metadata.error)}</p>` : ''}
<p>Appearance changes and base render failures are informational. Expand a scene and click an image to inspect it at full size.
Red pixels highlight differences, including antialiasing. No baseline images are stored in Git.</p>
<p>Render diagnostics: <a href="base/playwright/index.html">Base (${runs.base === 0 ? 'passed' : 'failed / not run'})</a> · <a href="head/playwright/index.html">PR (${runs.head === 0 ? 'passed' : 'failed / not run'})</a></p>
${cards}
</html>\n`
  )
  const changed = entries.filter((entry) => entry.status !== 'unchanged')
  await writeFile(
    join(reportDir, 'summary.md'),
    `## Desktop visual comparison\n\n${summary}\n\nBase: \`${metadata.baseSha}\`\n\nPR: \`${metadata.headSha}\`${metadata.workingTreeChanges ? ' + local tracked changes' : ''}\n\n${metadata.error ? `Error: ${metadata.error}\n\n` : ''}Appearance changes and base render failures are informational; PR render and interaction failures fail the check.\n${changed.length ? '\n' + changed.map((entry) => `- ${entry.name}: ${entry.status}${entry.changedPixels === undefined ? '' : ` (${entry.changedPixels} pixels)`}`).join('\n') + '\n' : ''}`
  )
  return result
}
