import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const SUBJECT = 'user-e2e'
const WORKSPACES = ['A', 'B', 'C']

export type ExtraRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) => boolean | Promise<boolean>

export type MintBehavior = (workspaceId: string, bearerWorkspace: string) => FakeReply | undefined

export interface FakeReply {
  status: number
  body: unknown
}

export interface BearerClaims {
  workspace_id?: string
  scope?: string
}

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(claims)}.fake-signature`
}

export function claimsOf(req: IncomingMessage): BearerClaims {
  const segment = req.headers.authorization?.replace('Bearer ', '').split('.')[1]
  if (!segment) return {}
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as BearerClaims
}

function tokenFor(workspaceId: string, lifetimeSeconds: number, scope?: string): string {
  const iat = Math.floor(Date.now() / 1000)
  return jwt({
    sub: SUBJECT,
    email: 'e2e@example.com',
    workspace_id: workspaceId,
    workspace_type: 'team',
    role: 'member',
    ...(scope ? { scope } : {}),
    iat,
    exp: iat + lifetimeSeconds
  })
}

export function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

export class FakeCloud {
  readonly authorizeUrls: URL[] = []
  readonly mints: { workspaceId: string; bearerWorkspace: string }[] = []
  readonly builds: { workspace: string; canMint: boolean }[] = []
  readonly members: string[] = []
  mintBehavior: MintBehavior = () => undefined
  consentOverride: string | null = null
  port = 0
  private server: Server | null = null
  private readonly codes = new Map<string, { workspaceId: string; scope: string }>()
  private nextId = 0

  constructor(private readonly extraRoute: ExtraRoute = () => false) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      void this.route(req, res)
    })
    this.server = server
    await new Promise<void>((resolve) => server.listen(this.port, '127.0.0.1', resolve))
    this.port = (server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url)
    if (await this.extraRoute(req, res, url)) return
    if (url.pathname === '/oauth/authorize') return this.authorize(url, res)
    if (url.pathname === '/oauth/token') return this.token(req, res)
    if (url.pathname === '/api/auth/token') return this.mint(req, res)
    if (url.pathname === '/api/workspaces') {
      return reply(res, 200, {
        workspaces: WORKSPACES.map((id) => ({
          id,
          name: `Workspace ${id}`,
          type: 'team',
          role: 'member'
        }))
      })
    }
    if (url.pathname === '/api/workspace/members') {
      this.members.push(claimsOf(req).workspace_id ?? '')
      return reply(res, 200, { members: [], pagination: { has_more: false } })
    }
    if (url.pathname === '/v1/builds') {
      const claims = claimsOf(req)
      this.builds.push({
        workspace: claims.workspace_id ?? '',
        canMint: claims.scope !== undefined
      })
      return reply(res, 200, { builds: [] })
    }
    reply(res, 404, { code: 'NOT_FOUND' })
  }

  private authorize(url: URL, res: ServerResponse): void {
    this.authorizeUrls.push(url)
    const code = `code-${++this.nextId}`
    this.codes.set(code, {
      workspaceId: this.consentOverride ?? url.searchParams.get('workspace_id') ?? 'A',
      scope: url.searchParams.get('scope') ?? ''
    })
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
    res.writeHead(302, { location: redirect.toString() })
    res.end()
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await bodyOf(req))
    const grant = this.codes.get(form.get('code') ?? form.get('refresh_token') ?? '')
    if (!grant) return reply(res, 400, { error: 'invalid_grant' })
    const refreshToken = `refresh-${++this.nextId}`
    this.codes.set(refreshToken, grant)
    reply(res, 200, {
      access_token: tokenFor(grant.workspaceId, 3600, grant.scope),
      refresh_token: refreshToken,
      expires_in: 3600
    })
  }

  private async mint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const workspaceId = (JSON.parse(await bodyOf(req)) as { workspace_id: string }).workspace_id
    const bearerWorkspace = claimsOf(req).workspace_id ?? ''
    this.mints.push({ workspaceId, bearerWorkspace })
    const scripted = this.mintBehavior(workspaceId, bearerWorkspace)
    if (scripted) return reply(res, scripted.status, scripted.body)
    reply(res, 200, {
      token: tokenFor(workspaceId, 900),
      expires_at: new Date(Date.now() + 900_000).toISOString()
    })
  }
}
