/**
 * The single main-process CloudSession + the ComfyBuilderClient built from it.
 *
 * Both the IPC handlers (auth / workspaces / builds / install) and the
 * comfy-builder SourcePlugin's `install()` read the SAME session here, so a
 * sign-in, workspace switch, or sign-out is reflected everywhere without any of
 * them owning their own token state. The client pulls a bearer token from the
 * session's `TokenProvider` per request; the token never leaves this process.
 */
import { BUILDER_BASE_URL, PLATFORM_WEB_BASE_URL } from './config'
import { CloudSession } from '../cloud'
import { ComfyBuilderClient } from '../comfybuilder'

let session: CloudSession | null = null
let client: ComfyBuilderClient | null = null
let unauthorizedHandler: (() => void) | null = null

/** The process-wide CloudSession (auth + workspace), created on first use. */
export function getCloudSession(): CloudSession {
  if (!session) session = new CloudSession()
  return session
}

/**
 * The catalog client, bound to the shared session's token provider and the
 * configured builder gateway. Cached: the session is the mutable part, and the
 * provider it hands out always reads the current tokens.
 */
export function getBuilderClient(): ComfyBuilderClient {
  if (!client) {
    client = new ComfyBuilderClient({
      baseUrl: BUILDER_BASE_URL,
      platformBaseUrl: PLATFORM_WEB_BASE_URL,
      auth: getCloudSession().asTokenProvider(() => unauthorizedHandler?.())
    })
  }
  return client
}

/** Announce an API-driven token invalidation to renderer auth stores. */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

/** @internal: reset the singletons between tests. */
export function _resetForTest(): void {
  session = null
  client = null
  unauthorizedHandler = null
}
