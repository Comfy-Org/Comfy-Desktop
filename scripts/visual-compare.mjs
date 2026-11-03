import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { writeReport } from './visual-report.mjs'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const reportDir = join(root, 'visual-report')
const { values } = parseArgs({
  options: { base: { type: 'string' }, help: { type: 'boolean' } }
})

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Git failed')
  return result.stdout.trim()
}

let activeChild = null
let interrupted = false
// A terminal already delivers Ctrl-C to the child, and Playwright force-quits on a second SIGINT.
process.on('SIGINT', () => {
  interrupted = true
})
process.on('SIGTERM', () => {
  interrupted = true
  activeChild?.kill('SIGTERM')
})

function run(command, args, cwd, env = {}) {
  return new Promise((succeed, fail) => {
    const interruption = () => new Error('Interrupted before the comparison finished.')
    if (interrupted) return fail(interruption())
    activeChild = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit'
    })
    activeChild.once('error', fail)
    activeChild.once('close', (code) => {
      activeChild = null
      if (interrupted) fail(interruption())
      else succeed(code ?? 1)
    })
  })
}

async function main() {
  if (values.help) {
    console.log('pnpm test:visual --base <git-ref>')
    console.log('Writes visual-report/index.html. Pixel differences do not fail the command.')
    return
  }
  const baseRef = values.base || process.env.VISUAL_BASE_REF
  if (!baseRef)
    throw new Error('Choose the PR base explicitly: pnpm test:visual --base origin/<branch>')
  const baseTip = git('rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`)
  // Commits that landed on the base after the PR branched are not the PR's changes.
  const baseSha = git('merge-base', baseTip, 'HEAD')
  const metadata = {
    baseRef,
    baseSha,
    headSha: git('rev-parse', 'HEAD'),
    workingTreeChanges: Boolean(git('status', '--porcelain', '--untracked-files=no')),
    platform: process.platform,
    playwright: require('@playwright/test/package.json').version
  }
  await rm(reportDir, { recursive: true, force: true })
  await mkdir(reportDir, { recursive: true })
  const temporaryDir = await realpath(await mkdtemp(join(tmpdir(), 'desktop-visual-')))
  const baseDir = join(temporaryDir, 'base')
  let worktreeAdded = false
  const runs = { base: null, head: null }
  let report
  try {
    git('worktree', 'add', '--detach', baseDir, baseSha)
    worktreeAdded = true
    await rm(join(baseDir, 'tests/visual'), { recursive: true, force: true })
    await cp(join(root, 'tests/visual'), join(baseDir, 'tests/visual'), { recursive: true })
    // Preserve the base's package manifest/lockfile and do not run install hooks.
    // pnpm can supply either a JS entrypoint or its standalone executable.
    if (!process.env.npm_execpath) throw new Error('Run this command through pnpm test:visual.')
    const pnpm = process.env.npm_execpath
    const installArgs = ['install', '--frozen-lockfile', '--ignore-scripts']
    const installStatus = await run(
      /\.[cm]?js$/.test(pnpm) ? process.execPath : pnpm,
      /\.[cm]?js$/.test(pnpm) ? [pnpm, ...installArgs] : installArgs,
      baseDir
    )
    if (installStatus !== 0) {
      throw new Error('Could not install the base version dependencies.')
    }
    for (const [label, sourceRoot] of [
      ['base', baseDir],
      ['head', root]
    ]) {
      console.log(`\nRendering ${label}: ${label === 'base' ? baseSha : metadata.headSha}`)
      runs[label] = await run(
        process.execPath,
        [require.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.visual.config.ts'],
        root,
        {
          VISUAL_SOURCE_ROOT: sourceRoot,
          VISUAL_OUTPUT_DIR: join(reportDir, label),
          VISUAL_CACHE_DIR: join(temporaryDir, `${label}-vite`)
        }
      )
    }
  } catch (error) {
    metadata.error = error.message
  } finally {
    try {
      report = await writeReport(reportDir, metadata, runs)
    } finally {
      if (worktreeAdded) git('worktree', 'remove', '--force', baseDir)
      await rm(temporaryDir, { recursive: true, force: true })
    }
  }
  console.log(`\n${report.summary}\nVisual comparison: ${join(reportDir, 'index.html')}`)
  if (!report.passed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
