import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'

export const FAKE_TOKEN = 't'.repeat(64)

const SCRIPT = String.raw`
const http = require('http')
const args = process.argv.slice(1)
const behaviour = args[args.indexOf('--bundle') + 1] || 'ready'
const verified = args.includes('--verify')
const token = '${FAKE_TOKEN}'
const say = (event) => process.stdout.write(JSON.stringify(event) + '\n')
const stdinEnds = (then) => { process.stdin.on('end', then); process.stdin.resume() }
if (behaviour.startsWith('fatal-')) {
  const code = Number(behaviour.slice(6))
  say({ event: 'fatal', code: 'x', exit: code, message: 'no' })
  process.exit(code)
} else if (behaviour === 'garbage') {
  process.stdout.write('not json\n')
  stdinEnds(() => process.exit(0))
} else if (behaviour === 'silent') {
  stdinEnds(() => process.exit(0))
} else if (behaviour === 'stubborn') {
  process.stdin.resume()
  setInterval(() => {}, 1000)
} else {
  const decisions = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer ' + token) {
        res.writeHead(401).end('{"error":"unauthorised"}')
        return
      }
      if (req.headers.origin !== undefined) {
        res.writeHead(403).end('{"error":"browser"}')
        return
      }
      if (req.url === '/api/decide') {
        const request = JSON.parse(body)
        decisions.push(request)
        if (behaviour === 'drop') {
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': 1000 })
          res.write('{"protocol":')
          setTimeout(() => req.socket.destroy(), 20)
          return
        }
        const reply = behaviour === 'slow' ? 4000 : 0
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ protocol: 1, request, outcome: { kind: 'unsat', reply: 'fake' }, split: { run: [], download: [] }, options: [] }))
        }, reply)
        return
      }
      res.writeHead(404).end('{}')
    })
  })
  server.listen(0, '127.0.0.1', () => {
    say({ event: 'ready', protocol: 1, port: server.address().port, token, verified,
      bundle: { version: '1.0.0' }, outcome_kinds: ['template', 'agent', 'bad_input', 'unsat', 'download'] })
  })
  stdinEnds(() => process.exit(0))
}
`

export function spawnFakeSidecar(
  _python: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess {
  return spawn(process.execPath, ['-e', SCRIPT, '--', ...args], options)
}
