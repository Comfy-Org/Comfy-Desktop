/**
 * The single main-process CloudSession + the ComfyBuilderClient built from it.
 *
 * Both the IPC handlers (auth / workspaces / distributions / install) and the
 * comfy-builder SourcePlugin's `install()` read the SAME session here, so a
 * sign-in, workspace switch, or sign-out is reflected everywhere without any of
 * them owning their own token state. The client pulls a bearer token from the
 * session's `TokenProvider` per request; the token never leaves this process.
 *
 * `./config` is imported first, for its side effect: it seeds the staging
 * `COMFY_CLOUD_ISSUER` default before the cloud library's config reads it.
 */
import { BUILDER_BASE_URL } from './config'
import { CloudSession } from '../cloud'
import { ComfyBuilderClient } from '../comfybuilder'

let session: CloudSession | null = null
let client: ComfyBuilderClient | null = null

/** The process-wide CloudSession (auth + workspace), created on first use. */
export function getCloudSession(): CloudSession {
  if (!session) session = new CloudSession()
  return session
}

/**
 * The catalog client, bound to the shared session's token provider and the
 * staging builder gateway. Cached — the session is the mutable part, and the
 * provider it hands out always reads the current tokens.
 */
export function getBuilderClient(): ComfyBuilderClient {
  if (!client) {
    client = new ComfyBuilderClient({
      baseUrl: BUILDER_BASE_URL,
      auth: getCloudSession().asTokenProvider(),
    })
  }
  return client
}

/** @internal — reset the singletons between tests. */
export function _resetForTest(): void {
  session = null
  client = null
}
