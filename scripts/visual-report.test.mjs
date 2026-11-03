import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { compareScreenshots, writeReport } from './visual-report.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-report-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const save = async (side, name, { width = 4, height = 4, change = false } = {}) => {
    const png = new PNG({ width, height })
    png.data.fill(255)
    if (change) png.data.set([0, 0, 0, 255], 0)
    const path = join(root, side, 'screenshots', name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, PNG.sync.write(png))
  }
  return { root, save }
}

const metadata = {
  baseRef: 'origin/main',
  baseSha: 'base-sha',
  headSha: 'head-sha',
  platform: 'darwin',
  playwright: '1.58.2',
  workingTreeChanges: false
}

test('identical renders are unchanged and need no diff image', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'controls.png')
  await save('head', 'controls.png')
  const report = await writeReport(root, metadata, { base: 0, head: 0 })
  assert.equal(report.complete, true)
  assert.equal(report.counts.unchanged, 1)
  assert.equal(report.entries[0].changedPixels, 0)
  assert.equal(report.entries[0].diff, undefined)
})

test('a single changed pixel is reported without failing a completed comparison', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'nested/controls.png')
  await save('head', 'nested/controls.png', { change: true })
  const report = await writeReport(root, metadata, { base: 0, head: 0 })
  assert.equal(report.complete, true)
  assert.equal(report.counts.changed, 1)
  assert.equal(report.entries[0].changedPixels, 1)
  const diff = PNG.sync.read(await readFile(join(root, report.entries[0].diff)))
  assert.deepEqual([...diff.data.subarray(0, 4)], [255, 0, 0, 255])
  assert.match(
    await readFile(join(root, 'summary.md'), 'utf8'),
    /controls.png: changed \(1 pixels\)/
  )
})

test('viewport or page height changes produce a padded diff', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'controls.png', { width: 4, height: 6 })
  await save('head', 'controls.png', { width: 6, height: 4 })
  const [entry] = await compareScreenshots(root)
  assert.equal(entry.status, 'changed')
  assert.equal(entry.baseSize, '4 × 6')
  assert.equal(entry.headSize, '6 × 4')
  const diff = PNG.sync.read(await readFile(join(root, entry.diff)))
  assert.equal(diff.width, 6)
  assert.equal(diff.height, 6)
})

test('missing scenes are shown as added or removed instead of unchanged', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'old.png')
  await save('head', 'new.png')
  const entries = await compareScreenshots(root)
  assert.deepEqual(
    entries.map(({ name, status }) => [name, status]),
    [
      ['new.png', 'added'],
      ['old.png', 'removed']
    ]
  )
})

test('a failed base render compares what both captured and does not fail the check', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'controls.png')
  await save('head', 'controls.png', { change: true })
  await save('head', 'new-scene.png')
  const report = await writeReport(root, metadata, { base: 1, head: 0 })
  assert.equal(report.complete, false)
  assert.equal(report.passed, true)
  assert.deepEqual(
    report.entries.map(({ name, status }) => [name, status]),
    [
      ['controls.png', 'changed'],
      ['new-scene.png', 'not compared']
    ]
  )
  assert.match(await readFile(join(root, 'summary.md'), 'utf8'), /Base render failed/)
})

test('a failed PR render fails the check without reporting scenes as removed', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'controls.png')
  await save('base', 'menu.png')
  await save('head', 'controls.png')
  const report = await writeReport(root, metadata, { base: 0, head: 1 })
  assert.equal(report.complete, false)
  assert.equal(report.passed, false)
  assert.deepEqual(
    report.entries.map(({ name, status }) => [name, status]),
    [
      ['controls.png', 'unchanged'],
      ['menu.png', 'not compared']
    ]
  )
  assert.match(await readFile(join(root, 'summary.md'), 'utf8'), /PR render failed/)
})

test('a comparison that never rendered fails and reaches no visual conclusion', async (t) => {
  const { root, save } = await fixture(t)
  await save('base', 'controls.png')
  const report = await writeReport(
    root,
    { ...metadata, error: 'Could not install' },
    { base: null, head: null }
  )
  assert.equal(report.passed, false)
  assert.deepEqual(report.entries, [])
  assert.match(await readFile(join(root, 'summary.md'), 'utf8'), /Comparison incomplete/)
})

test('empty captures are errors and report metadata is escaped in HTML', async (t) => {
  const { root } = await fixture(t)
  await assert.rejects(writeReport(root, metadata, { base: 0, head: 0 }), /No screenshots/)
  await writeReport(
    root,
    { ...metadata, baseRef: '<script>alert(1)</script>', error: 'Failed <render>' },
    { base: null, head: null }
  )
  const html = await readFile(join(root, 'index.html'), 'utf8')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Failed &lt;render&gt;/)
})
