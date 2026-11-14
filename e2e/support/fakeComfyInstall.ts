import path from 'node:path'
import process from 'node:process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'

const SUPPORTED_FLAGS = [
  ['--port PORT', 'Set the listen port.'],
  ['--listen [IP]', 'Specify the IP address to listen on.'],
  ['--enable-manager', 'Enable ComfyUI-Manager.'],
  ['--enable-assets', 'Enable the assets subsystem.'],
  ['--enable-asset-hashing', 'Hash assets while scanning.'],
  ['--user-directory USER_DIRECTORY', 'Set the ComfyUI user directory.'],
  ['--input-directory INPUT_DIRECTORY', 'Set the ComfyUI input directory.'],
  ['--output-directory OUTPUT_DIRECTORY', 'Set the ComfyUI output directory.'],
  ['--extra-model-paths-config PATH', 'Load extra model paths from a YAML file.'],
  ['--feature-flag KEY=VALUE', 'Set a desktop feature flag.'],
  ['--list-feature-flags', 'List supported feature flags and exit.']
] as const

function helpText(): string {
  const options = SUPPORTED_FLAGS.map(
    ([flag, help]) => `  ${flag}\n                        ${help}`
  )
  return [
    `usage: main.py [-h] [${SUPPORTED_FLAGS.map(([f]) => f.split(' ')[0]).join('] [')}]`,
    '',
    'options:',
    '  -h, --help            show this help message and exit',
    ...options,
    ''
  ].join('\n')
}

const SERVER_JS = `
const http = require('node:http')
// A \`startup-failure\` file beside this script makes the stub print it to stderr and exit 1,
// as ComfyUI does when it refuses to start. Written synchronously, so exiting loses none of it.
const failurePath = require('node:path').join(__dirname, 'startup-failure')
if (require('node:fs').existsSync(failurePath)) {
  require('node:fs').writeSync(2, require('node:fs').readFileSync(failurePath))
  process.exit(1)
}
// Serve until killed. Deliberately no stdin-close guard: the launcher spawns this with stdio
// pipes it does not write to, so watching stdin would fire immediately and the launch would
// see "process exited with code 0" instead of a booted server. The launcher's own
// killProcessTree ends it, and a leaked one dies with the profile's port anyway.
const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex === -1 ? 8188 : Number(args[portIndex + 1])
const grantOn = args.includes('--enable-asset-hashing')
const body = \`<!doctype html><html><head><meta charset="utf-8"><title>ComfyUI (e2e stub)</title>
<style>
  html,body{margin:0;height:100%;background:#16121a;color:#cfc8d6;
    font:14px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;opacity:.75}
  code{color:#e3ff3c}
</style></head><body><div class="card">
  <p>ComfyUI stub &mdash; e2e fixture canvas</p>
  <p>launched with <code>\${grantOn ? '--enable-asset-hashing' : 'no beta grant'}</code></p>
</div></body></html>\`
const server = http.createServer((req, res) => {
  // ComfyUI's queue endpoint, which Desktop asks before stopping an earlier ComfyUI. Reports a
  // prompt running while a \`queue-busy\` file sits beside this script.
  if (req.url === '/queue') {
    // A \`queue-hang\` file makes the stub never answer, like a ComfyUI stalled mid-prompt.
    if (require('node:fs').existsSync(require('node:path').join(__dirname, 'queue-hang'))) return
    const busy = require('node:fs').existsSync(require('node:path').join(__dirname, 'queue-busy'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ queue_running: busy ? [[0, 'e2e-prompt']] : [], queue_pending: [] }))
    return
  }
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
  installPath: string
  port: number
}

export async function writeFakeComfyInstall(opts: {
  installPath: string
  port: number
  serverScript?: string
}): Promise<FakeComfyInstall> {
  const { installPath, port, serverScript = SERVER_JS } = opts
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })
  await writeFile(path.join(installPath, 'ComfyUI', 'main.py'), '# e2e stub\n')

  const serverPath = path.join(installPath, 'stub-server.cjs')
  await writeFile(serverPath, serverScript)

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
    ''
  ].join('\n')
  const python = path.join(installPath, 'venv', 'bin', 'python3')
  await writeFile(python, sh)
  await chmod(python, 0o755)

  return { installPath, port }
}

export function opsFlagsGrantSeed(opts: {
  arg: string
  minCoreVersion?: string
  commitRanges?: [string, string | null][]
  description?: string
  notice?: 'silent'
}): Record<string, unknown> {
  return {
    desktop_core_beta_features: {
      value: 'treatment',
      payload: {
        flags: [
          {
            arg: opts.arg,
            ...(opts.commitRanges === undefined
              ? { min_core_version: opts.minCoreVersion }
              : { commit_ranges: opts.commitRanges }),
            ...(opts.description === undefined ? {} : { description: opts.description }),
            ...(opts.notice === undefined ? {} : { notice: opts.notice })
          }
        ]
      }
    }
  }
}
