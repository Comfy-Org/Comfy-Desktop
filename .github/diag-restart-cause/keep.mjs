// Temporary diagnostics: keep each run's launcher profile and fake install so their logs can be uploaded. Not for merge.
import { readFileSync, writeFileSync } from 'node:fs'
const edits = [
  ['e2e/support/electronHarness.ts', 'await rm(homeDir, { recursive: true, force: true })', "if (process.env['DIAG_KEEP'] !== '1') await rm(homeDir, { recursive: true, force: true })"],
  ['e2e/core-beta-args-pill-restart.test.ts', 'if (installPath) await rm(installPath, { recursive: true, force: true })', "if (installPath && process.env['DIAG_KEEP'] !== '1') await rm(installPath, { recursive: true, force: true })"],
]
for (const [file, from, to] of edits) {
  const src = readFileSync(file, 'utf8')
  if (src.split(from).length !== 2) throw new Error(`expected exactly one match in ${file}`)
  writeFileSync(file, src.replace(from, to))
  console.log(`kept: ${file}`)
}
