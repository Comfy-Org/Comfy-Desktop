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
  window.open(url, '_blank', 'noopener,noreferrer')
}
```

`ComfyDesktop2BridgeImplementation` is the provider-side counterpart: it makes
every top-level member required, so Desktop's preload cannot claim the contract
while omitting part of it.

## Comfy pages hosted in Desktop's Apps view

A Comfy page that Desktop shows in its Apps view gets three objects instead,
and nothing else of the bridge above: `window.comfyDesktopAuth`, Desktop's
account session, `window.comfyDesktopLocal`, a ComfyUI on this computer, and
`window.comfyDesktopTelemetry`, the page's usage events.

```ts
import type {
  ComfyDesktopHostedAuthBridge,
  ComfyDesktopHostedLocalBridge,
  ComfyDesktopHostedTelemetryBridge
} from '@comfyorg/comfyui-desktop-bridge-types'

declare global {
  interface Window {
    comfyDesktopAuth?: ComfyDesktopHostedAuthBridge
    comfyDesktopLocal?: ComfyDesktopHostedLocalBridge
    comfyDesktopTelemetry?: ComfyDesktopHostedTelemetryBridge
  }
}
```

The page reads the session with `getState()`, follows it with `onChanged()`,
asks for the workspace credential with `getWorkspaceToken(workspaceId)` each
time it calls Comfy Cloud, and starts a sign-in with `requestSignIn()`. It
cannot sign Desktop out or switch workspace.

For a run on this computer the page asks `getLocal({ minVersion })` which of
the person's builds Desktop would use, starts it with `startLocal()`, and then
talks to it through `localFetch()`. Desktop forwards only the calls a run
needs, and only for runs the page started; `onLocalEvent()` carries ComfyUI's
updates for those runs. `localDownload()` saves a safetensors model from
Hugging Face into that build's models folder.

`track(name, props)` reports what the person does on the page, such as
`track('click', { target: 'run' })`. Desktop sends it as
`comfy.desktop.apps.<name>` only when the person allows telemetry, and adds
`app_id`, the app whose page Desktop loaded in that view. An event the page
sends while the view loads another app is dropped.

- A name starts with a lowercase letter, then lowercase letters, digits and
  `_`, up to 48 characters in all (`^[a-z][a-z0-9_]{0,47}$`), so `2_click` is
  dropped. `app_opened` and `app_page_failed` are Desktop's own and are
  refused, and so is `error`.
- Desktop keeps up to 16 properties. A key starts with a lowercase letter,
  then lowercase letters, digits and `_`, up to 32 characters in all
  (`^[a-z][a-z0-9_]{0,31}$`), so `{ Run: true }` is dropped. A value is a
  boolean, a finite number or a slug of up to 64 characters
  (`^[a-z0-9][a-z0-9._-]{0,63}$`). Free text, any other key or value, and an
  `app` or `app_id` from the page are dropped.
- Desktop sets these keys on every event itself, so the page's value for any
  of them is dropped: `app_version`, `app_channel`, `app_env`, `is_packaged`,
  `platform`, `arch`, `client`, `installation_id` and `sac_state`.
- Desktop sends at most 60 events a minute for one app and 1,000 page events a
  session. Events telemetry did not send, as while consent is off, do not
  count.
- Desktop's telemetry also sends at most 60 of one event name a minute, shared
  by every app. If one app sends 60 `click` events in a minute, a `click` from
  another app in that minute is dropped too.

The page is not told when Desktop drops an event.

All three objects are absent in a browser, so a page keeps its own sign-in and
its own way to reach a local ComfyUI as the fallback, and sends no events.

## Provenance

Generated from `src/types/comfyDesktopBridge.ts` in
[Comfy-Org/Comfy-Desktop](https://github.com/Comfy-Org/Comfy-Desktop), which is
the same file the preload implements. Edit that file, run
`pnpm run bridge-types:gen`, and bump the version in this package's
`package.json`. Merging to `main` then publishes it; CI refuses a contract
change that arrives without a bump.
