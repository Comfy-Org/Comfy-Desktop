import { BUILDER_BASE_URL } from './config'
import { CloudSession } from '../cloud'
import { ComfyBuilderClient } from '../comfybuilder'

let session: CloudSession | null = null
let client: ComfyBuilderClient | null = null
let unauthorizedHandler: (() => void) | null = null

export function getCloudSession(): CloudSession {
  if (!session) session = new CloudSession()
  return session
}

export function getBuilderClient(): ComfyBuilderClient {
  if (!client) {
    client = new ComfyBuilderClient({
      baseUrl: BUILDER_BASE_URL,
      auth: getCloudSession().asTokenProvider(() => unauthorizedHandler?.())
    })
  }
  return client
}

export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler
}

export function _resetForTest(): void {
  session = null
  client = null
  unauthorizedHandler = null
}
