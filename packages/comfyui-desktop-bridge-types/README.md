# @comfyorg/comfyui-desktop-bridge-types

TypeScript definitions for `window.__comfyDesktop2`, the API Comfy Desktop
exposes to the frontend it hosts.

```sh
npm install --save-dev @comfyorg/comfyui-desktop-bridge-types
```

```ts
import type { ComfyDesktop2Bridge } from '@comfyorg/comfyui-desktop-bridge-types'

declare global {
  interface Window {
    __comfyDesktop2?: ComfyDesktop2Bridge
  }
}
```

## Every member is optional for a reason

Which members actually exist at runtime is decided by the Desktop binary the
user is running, and Desktop binaries update far more slowly than the frontend
that ships into them. Callers must guard every access and carry a fallback —
including when the member exists but rejects:

```ts
async function openModelAccessPage(url: string): Promise<void> {
  try {
    if ((await window.__comfyDesktop2?.openModelAccessPage?.(url)) === true) return
  } catch (error) {
    console.error('Desktop could not open the access page:', error)
  }
  window.open(url, '_blank')
}
```

`ComfyDesktop2BridgeImplementation` is the provider-side counterpart: it makes
every top-level member required, so Desktop's preload cannot claim the contract
while omitting part of it.

## Provenance

Generated from `src/types/comfyDesktopBridge.ts` in
[Comfy-Org/Comfy-Desktop](https://github.com/Comfy-Org/Comfy-Desktop), which is
the same file the preload implements. Edit that file, run
`pnpm run bridge-types:gen`, and merging publishes the result.
