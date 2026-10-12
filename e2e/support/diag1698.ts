/** Temporary diagnostics for the core-beta-args-pill-commit flake (PR #1698). Not for merge. */
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { getIpcInvocations } from './devHooks'

export const FORCE = process.env['DIAG_FORCE'] ?? 'none'

export const T: Record<string, number> = {}
export const mark = (key: string): void => {
  T[key] = Date.now()
}

let slowDir: string | null = null

/** Every `git` the app spawns from now on sleeps first, so answers arrive late. */
export async function slowAppGit(app: ElectronApplication): Promise<void> {
  if (!slowDir) {
    slowDir = await mkdtemp(path.join(os.tmpdir(), 'diag-slowgit-'))
    const real = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim()
    const wrapper = path.join(slowDir, 'git')
    await writeFile(wrapper, `#!/bin/sh\nsleep 0.4\nexec ${real} "$@"\n`)
    await chmod(wrapper, 0o755)
  }
  await app.evaluate((_electron, dir) => {
    process.env['PATH'] = `${dir}:${process.env['PATH']}`
  }, slowDir)
}

export async function restoreAppGit(app: ElectronApplication): Promise<void> {
  if (!slowDir) return
  await app.evaluate((_electron, dir) => {
    process.env['PATH'] = (process.env['PATH'] ?? '')
      .split(':')
      .filter((entry) => entry !== dir)
      .join(':')
  }, slowDir)
}

export async function dump(
  app: ElectronApplication,
  label: string,
  sha: Record<string, string>,
): Promise<void> {
  const channels = ['get-core-beta-args', 'get-core-beta-args:answered', 'diag:answer', 'diag:relate', 'diag:head']
  const records: Record<string, unknown> = {}
  for (const channel of channels) records[channel] = await getIpcInvocations(app, channel)
  const short = Object.fromEntries(Object.entries(sha).map(([name, value]) => [value, name]))
  const text = JSON.stringify({
    label,
    status: test.info().status,
    repeat: test.info().repeatEachIndex,
    force: FORCE,
    T,
    records,
  }).replace(/[0-9a-f]{40}/g, (full) => short[full] ?? full.slice(0, 8))
  console.log(`DIAG ${text}`)
}
