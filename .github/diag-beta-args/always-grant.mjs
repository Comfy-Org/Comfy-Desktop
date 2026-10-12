// Temporary diagnostics: the always-grant mutant without `git apply`, so CRLF checkouts work. Not for merge.
import { readFileSync, writeFileSync } from 'node:fs'
const file = 'src/main/lib/ipc/registerInstallationHandlers.ts'
const from = '}).then((answer) => {'
const to = "}).then((real) => ({ ...real, args: [{ arg: '--enable-asset-hashing', name: 'Asset hashing' }] })).then((answer) => {"
const src = readFileSync(file, 'utf8')
if (src.split(from).length !== 2) throw new Error(`expected exactly one ${from}`)
writeFileSync(file, src.replace(from, to))
console.log(`mutated ${file}`)
