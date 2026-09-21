/**
 * A ComfyUI install that is fake everywhere except the two places the Core beta grant path
 * actually looks.
 *
 * `buildLaunchArgs` only ever sees a grant through two real gates, and both have to be genuine
 * for an end-to-end run to prove anything:
 *
 *   1. `getComfyArgsSchema` runs `<python> -s main.py --help` and parses the argparse block, so
 *      the stub answers `--help` with a real usage listing. A grant the listing omits is
 *      filtered out as `dropped_unsupported`, exactly as an older core would drop it.
 *   2. The launch then spawns that same stub for real and waits for the port, so the stub
 *      serves HTTP until it is killed. Without that the launch fails at the boot wait and the
 *      window never leaves the progress takeover.
 *
 * Node runs the server rather than Python because there is no interpreter to depend on: the
 * absolute path of the node binary already running Playwright is baked into the stub.
 *
 * LINUX only, deliberately — two independent reasons.
 *
 * A Windows stub would have to be a real PE executable: `venvPython`
 * resolves to `venv/python.exe`, and both callers run it with no shell (`execFile` in
 * `comfy-args.ts`, `spawn` in `process.ts`), so `CreateProcessW` rejects anything that is not a
 * PE image. Naming a batch file `.exe` does not help — only a `.bat`/`.cmd` EXTENSION makes
 * Windows hand off to `cmd.exe`. `e2e/comfybuilder-launch.test.ts` writes an EMPTY `python.exe`
 * for exactly this reason: its assertion is that the launch is attempted and fails.
 *
 * macOS is excluded for a different reason: nothing isolates it. `configDir()` resolves to
 * Electron's `userData` there, which ignores the harness's HOME override, so the ops-flag seed
 * these specs need would be written into the developer's (or runner's) REAL profile — leaving
 * the seeded rollout enabled after the run and leaking state into later tests. Fixing that
 * needs the harness to redirect `userData` before main resolves any path, which is a change to
 * app startup and does not belong in this PR.
 *
 * Specs using this fixture are therefore tagged `@linux` only.
 */
import path from 'node:path'
import process from 'node:process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'

/** Flags the stub's `--help` advertises. `--enable-assets` is here because the grant under
 *  test names it; a core that did not know the flag would leave it out and the launch would
 *  drop it. `--port` and `--listen` are what the launcher itself passes. */
const SUPPORTED_FLAGS = [
  ['--port PORT', 'Set the listen port.'],
  ['--listen [IP]', 'Specify the IP address to listen on.'],
  ['--enable-manager', 'Enable ComfyUI-Manager.'],
  ['--enable-assets', 'Enable the assets subsystem.'],
  ['--user-directory USER_DIRECTORY', 'Set the ComfyUI user directory.'],
  ['--input-directory INPUT_DIRECTORY', 'Set the ComfyUI input directory.'],
  ['--output-directory OUTPUT_DIRECTORY', 'Set the ComfyUI output directory.'],
  ['--extra-model-paths-config PATH', 'Load extra model paths from a YAML file.'],
  ['--feature-flag KEY=VALUE', 'Set a desktop feature flag.'],
  ['--list-feature-flags', 'List supported feature flags and exit.'],
] as const

function helpText(): string {
  const options = SUPPORTED_FLAGS.map(([flag, help]) => `  ${flag}\n                        ${help}`)
  return [
    `usage: main.py [-h] [${SUPPORTED_FLAGS.map(([f]) => f.split(' ')[0]).join('] [')}]`,
    '',
    'options:',
    '  -h, --help            show this help message and exit',
    ...options,
    '',
  ].join('\n')
}

/** Minimal always-200 server on the launcher's chosen port, so `waitForPort` succeeds and the
 *  host window navigates to a page rather than an error. The body is deliberately plain and
 *  labelled — it is the backdrop every screenshot of the notice is taken against, and an
 *  unlabelled blank page would look like a rendering failure in the evidence. */
const SERVER_JS = `
const http = require('node:http')
// Serve until killed. Deliberately no stdin-close guard: the launcher spawns this with stdio
// pipes it does not write to, so watching stdin would fire immediately and the launch would
// see "process exited with code 0" instead of a booted server. The launcher's own
// killProcessTree ends it, and a leaked one dies with the profile's port anyway.
const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex === -1 ? 8188 : Number(args[portIndex + 1])
const assetsOn = args.includes('--enable-assets')
const body = \`<!doctype html><html><head><meta charset="utf-8"><title>ComfyUI (e2e stub)</title>
<style>
  html,body{margin:0;height:100%;background:#16121a;color:#cfc8d6;
    font:14px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;opacity:.75}
  code{color:#e3ff3c}
</style></head><body><div class="card">
  <p>ComfyUI stub &mdash; e2e fixture canvas</p>
  <p>launched with <code>\${assetsOn ? '--enable-assets' : 'no beta grant'}</code></p>
</div></body></html>\`
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
})
// The port was reserved by binding 0 and closing, so between that close and this listen the
// OS may hand it to someone else, and a lingering TIME_WAIT can refuse it briefly. The port
// is fixed (the launcher was told it explicitly), so retry the SAME one rather than shifting
// to another the launcher would never poll. Zero tolerance for flaky tests means the transient
// case has to self-heal, not merely be documented.
let attemptsLeft = 40
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE' || attemptsLeft <= 0) throw err
  attemptsLeft -= 1
  setTimeout(() => server.listen(port, '127.0.0.1'), 250)
})
server.on('listening', () => {
  // The launcher's boot-log tap reads stdout; printing the usual banner keeps the console
  // pane readable while a run is being watched.
  console.log('Starting server\\n')
  console.log('To see the GUI go to: http://127.0.0.1:' + port)
})
server.listen(port, '127.0.0.1')
`

/**
 * A port nothing is listening on right now, found by binding 0 and reading back what the OS
 * chose. Far better than a constant, which collides with whatever else is on the machine and
 * fails as either `EADDRINUSE` or — worse — the launcher mistaking an unrelated listener for
 * the booted fixture.
 *
 * A gap remains between releasing the probe socket and the stub binding the port, and it
 * cannot be closed from here without handing the listening socket to the child. The stub
 * absorbs it instead: it retries the same port on `EADDRINUSE` (see `stubServerSource`), so a
 * lost race costs a few hundred milliseconds rather than a failed run.
 */
export async function reserveFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('could not determine a free port')))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
  })
}

export interface FakeComfyInstall {
  /** `installPath` for the seeded record. */
  installPath: string
  /** Port the stub serves on; also passed through `launchArgs` so it is explicit and the
   *  launcher's port-conflict auto-shift can never move it out from under an assertion. */
  port: number
}

/**
 * Write the on-disk layout `comfybuilder`'s `buildLaunchSpec` requires: a venv interpreter and
 * `ComfyUI/main.py`. Deliberately NOT a git checkout — `coreRecordCurrent` treats a non-git
 * install as "nothing can contradict the record", which is the ordinary standalone/archive
 * case and keeps the seeded `comfyVersion` authoritative.
 */
export async function writeFakeComfyInstall(opts: {
  installPath: string
  port: number
}): Promise<FakeComfyInstall> {
  const { installPath, port } = opts
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })
  await writeFile(path.join(installPath, 'ComfyUI', 'main.py'), '# e2e stub\n')

  const serverPath = path.join(installPath, 'stub-server.cjs')
  await writeFile(serverPath, SERVER_JS)

  if (process.platform !== 'linux') {
    throw new Error(
      'writeFakeComfyInstall is Linux-only (see the file header); tag the spec @linux.'
    )
  }

  await mkdir(path.join(installPath, 'venv', 'bin'), { recursive: true })
  const sh = [
    '#!/bin/sh',
    'case "$*" in',
    '  *--help*)',
    "    cat <<'COMFY_USAGE'",
    helpText(),
    'COMFY_USAGE',
    '    exit 0',
    '    ;;',
    'esac',
    `exec "${process.execPath}" "${serverPath}" "$@"`,
    '',
  ].join('\n')
  const python = path.join(installPath, 'venv', 'bin', 'python3')
  await writeFile(python, sh)
  await chmod(python, 0o755)

  return { installPath, port }
}

/** The persisted ops-flag entry `coreBetaGrants` reads when PostHog is unreachable. Handed to
 *  `launchApp`'s `opsFlags`, which delivers it through `E2E_OPS_FLAGS_SEED` so MAIN writes it to
 *  the real `configDir()`. The harness cannot write it itself: that path is Electron's
 *  `userData` off Linux, and macOS ignores the HOME override for it, so a hand-placed file is
 *  read on Linux and silently ignored everywhere else. */
export function opsFlagsGrantSeed(opts: {
  arg: string
  minCoreVersion: string
}): Record<string, unknown> {
  return {
    desktop_core_beta_features: {
      value: 'treatment',
      payload: { flags: [{ arg: opts.arg, min_core_version: opts.minCoreVersion }] },
    },
  }
}
