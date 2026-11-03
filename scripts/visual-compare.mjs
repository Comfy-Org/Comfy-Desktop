import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
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

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  return result.status ?? 1
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
  const baseSha = git('rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`)
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
  try {
    git('worktree', 'add', '--detach', baseDir, baseSha)
    worktreeAdded = true
    await rm(join(baseDir, 'tests/visual'), { recursive: true, force: true })
    await cp(join(root, 'tests/visual'), join(baseDir, 'tests/visual'), {
      recursive: true,
      filter: (path) => basename(path) !== '__screenshots__'
    })
    // Preserve the base's package manifest/lockfile and do not run install hooks.
    // pnpm can supply either a JS entrypoint or its standalone executable.
    if (!process.env.npm_execpath) throw new Error('Run this command through pnpm test:visual.')
    const pnpm = process.env.npm_execpath
    const installArgs = ['install', '--frozen-lockfile', '--ignore-scripts']
    if (
      run(
        /\.[cm]?js$/.test(pnpm) ? process.execPath : pnpm,
        /\.[cm]?js$/.test(pnpm) ? [pnpm, ...installArgs] : installArgs,
        baseDir
      ) !== 0
    ) {
      throw new Error('Could not install the base version dependencies.')
    }
    for (const [label, sourceRoot] of [
      ['base', baseDir],
      ['head', root]
    ]) {
      console.log(`\nRendering ${label}: ${label === 'base' ? baseSha : metadata.headSha}`)
      runs[label] = run(
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
      await writeReport(reportDir, metadata, runs)
    } finally {
      if (worktreeAdded) git('worktree', 'remove', '--force', baseDir)
      await rm(temporaryDir, { recursive: true, force: true })
    }
  }
  console.log(`\nVisual comparison: ${join(reportDir, 'index.html')}`)
  // A changed appearance is information. An incomplete render is an error.
  if (metadata.error || runs.base !== 0 || runs.head !== 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
