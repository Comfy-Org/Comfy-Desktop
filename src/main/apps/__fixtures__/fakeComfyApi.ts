export const FAKE_OUTPUT_TEXT = 'e2e cutout bytes'
export const SOMEONE_ELSES_RUN = 'someone-elses-run'

export interface FakeComfySeen {
  asked: string[]
  sockets: string[]
  prompts: { id: string; clientId: string; app: string | null; nodes: string[] }[]
  uploads: { name: string; subfolder: string; overwrite: boolean; bytes: number }[]
  interrupted: string[]
}

export const FAKE_COMFY_API_SERVER = `
const http = require('node:http')
const crypto = require('node:crypto')
const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex === -1 ? 8188 : Number(args[portIndex + 1])
const seen = { asked: [], sockets: [], prompts: [], uploads: [], interrupted: [] }
const sockets = new Map()
const history = {}
const OUTPUT = Buffer.from(${JSON.stringify(FAKE_OUTPUT_TEXT)})
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function frame(text) {
  const payload = Buffer.from(text)
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([header, payload])
}

function tell(clientId, message) {
  const socket = sockets.get(clientId)
  if (socket) socket.write(frame(JSON.stringify(message)))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

async function upload(req, res) {
  const body = await readBody(req)
  const text = body.toString('latin1')
  const name = (/filename="([^"]+)"/.exec(text) || [])[1] || ''
  const subfolder = (/name="subfolder"\\r\\n\\r\\n([^\\r]*)/.exec(text) || [])[1] || ''
  seen.uploads.push({ name, subfolder, overwrite: /name="overwrite"/.test(text), bytes: body.length })
  json(res, { name, subfolder, type: 'input' })
}

async function prompt(req, res) {
  const sent = JSON.parse((await readBody(req)).toString('utf8'))
  const id = 'e2e-run-' + (seen.prompts.length + 1)
  const tag = (sent.extra_data && sent.extra_data.comfy_app) || {}
  seen.prompts.push({
    id,
    clientId: sent.client_id,
    app: typeof tag.name === 'string' ? tag.name : null,
    nodes: Object.keys(sent.prompt || {})
  })
  json(res, { prompt_id: id, number: seen.prompts.length, node_errors: {} })
  setTimeout(() => {
    tell(sent.client_id, { type: 'execution_start', data: { prompt_id: id, timestamp: Date.now() } })
    tell(sent.client_id, { type: 'executing', data: { prompt_id: id, node: 'cut' } })
    tell(sent.client_id, { type: 'executing', data: { prompt_id: ${JSON.stringify(SOMEONE_ELSES_RUN)}, node: 'private' } })
    history[id] = {
      status: { status_str: 'success', completed: true },
      outputs: { save: { images: [{ filename: 'cutout_00001_.png', subfolder: 'apps', type: 'output' }] } }
    }
    tell(sent.client_id, { type: 'execution_success', data: { prompt_id: id } })
  }, 150)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/e2e/seen') return json(res, seen)
  seen.asked.push(req.method + ' ' + url.pathname)
  if (url.pathname === '/queue' && req.method === 'GET') {
    return json(res, {
      queue_running: [[1, ${JSON.stringify(SOMEONE_ELSES_RUN)}, { 3: { class_type: 'KSampler' } }, { client_id: 'their-window' }]],
      queue_pending: []
    })
  }
  if (url.pathname === '/upload/image' && req.method === 'POST') return void upload(req, res)
  if (url.pathname === '/prompt' && req.method === 'POST') return void prompt(req, res)
  if (url.pathname === '/interrupt' && req.method === 'POST') {
    return void readBody(req).then((body) => {
      seen.interrupted.push(JSON.parse(body.toString('utf8')).prompt_id)
      json(res, {})
    })
  }
  const run = /^\\/history\\/([\\w-]+)$/.exec(url.pathname)
  if (run) return json(res, history[run[1]] ? { [run[1]]: history[run[1]] } : {})
  if (url.pathname === '/view') {
    res.writeHead(200, { 'content-type': 'image/png' })
    return res.end(OUTPUT)
  }
  if (url.pathname.startsWith('/object_info/')) return json(res, {})
  if (url.pathname === '/system_stats') return json(res, { system: { comfyui_version: '0.42.1' } })
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><title>ComfyUI (e2e stub)</title><p>ComfyUI stub</p>')
})

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const accept = crypto
    .createHash('sha1')
    .update(req.headers['sec-websocket-key'] + WS_GUID)
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n' +
      'Sec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n'
  )
  const clientId = url.searchParams.get('clientId') || ''
  sockets.set(clientId, socket)
  seen.sockets.push(clientId)
  socket.on('data', () => {})
  socket.on('error', () => {})
  socket.on('close', () => {
    if (sockets.get(clientId) === socket) sockets.delete(clientId)
  })
})

let attemptsLeft = 40
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE' || attemptsLeft <= 0) throw err
  attemptsLeft -= 1
  setTimeout(() => server.listen(port, '127.0.0.1'), 250)
})
server.on('listening', () => {
  console.log('Starting server\\n')
  console.log('To see the GUI go to: http://127.0.0.1:' + port)
})
server.listen(port, '127.0.0.1')
`
