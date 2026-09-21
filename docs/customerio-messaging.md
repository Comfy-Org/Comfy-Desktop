# Customer.io messages in local ComfyUI

Desktop loads the Customer.io browser SDK into the local ComfyUI page after the
main process confirms all of the following:

- The attached installation is local and its ComfyUI panel is visible and focused.
- The user has enabled Desktop telemetry.
- The page has affirmed the Firebase UID verified by Desktop's authentication
  flow, and the other authentication reporters agree.

Signing out, changing accounts, revoking consent, leaving ComfyUI, or hiding its
window clears the messaging session and removes visible messages. Launcher,
onboarding, remote installations, and embedded Cloud do not receive this SDK.
Embedded Cloud continues to own its existing integration.

## Campaign configuration

The default public browser keys in `src/shared/customerIo.ts` use the existing
Cloud Customer.io source. Identity is the same Firebase UID used on Cloud.
Desktop sends `identify` with the selected locale, a page named
**`desktop/comfyui`**, and the SDK's delivery/interaction metrics. Page
properties also use this synthetic target, rather than the local workflow URL.

Configure Desktop messages to match that page name. Audit campaigns with no page
restriction before rollout: those can match Desktop users too. Native HTTP(S) and
email message actions open externally; opening a message link must leave the
ComfyUI workflow in place.

## Runtime and development

Packaged builds enable messaging when the eligibility conditions above hold.
Development builds default off. Environment overrides:

| Variable                                 | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `COMFY_CUSTOMER_IO_ENABLED=true`         | Enable messaging during development            |
| `COMFY_CUSTOMER_IO_ENABLED=false` or `0` | Disable messaging for this process             |
| `COMFY_CUSTOMER_IO_WRITE_KEY`            | Override the public Data Pipelines browser key |
| `COMFY_CUSTOMER_IO_SITE_ID`              | Override the public in-app site ID             |

The browser SDK is bundled as a script and executed in ComfyUI's browser context.
It receives no Node access. Its location and local/session storage accesses are
redirected at build time to a private synthetic URL and in-memory stores. This
applies before SDK initialization, so URL parameters cannot select an identity,
trigger events, or add campaign/referrer metadata. The SDK's fallback route uses
`/desktop/comfyui`, never the real workflow path. Native link handling owns
navigation; SDK location assignments cannot replace the workflow. Browser
persistence is disabled and ComfyUI's own URL and storage remain intact.
Session identity is reset before switching accounts. Network failures do
not block loading or using ComfyUI; another activation or an online event can retry.

## Verification

After building, run the isolated Electron fixture on the current platform:

```sh
pnpm exec electron-vite build
pnpm exec playwright test e2e/customerio.test.ts --project=macos --retries=0
```

Use `windows` or `linux` for the corresponding host. This test runs the shipped
preload and real SDK with intercepted network responses and disposable identities.
It covers rendering, opened metrics, dismissal, account changes, revocation, and
continued access to the workflow and its existing browser storage.

Unit tests cover main-process eligibility, frame validation, link handling,
authentication consensus, and asynchronous session changes.

Release verification still needs a restricted live Customer.io campaign and
packaged macOS/Windows checks. Confirm the intended profile receives a message in
local ComfyUI, its delivery/open/click records appear, links preserve the workflow,
and embedded Cloud does not receive a second SDK. Fixture results do not establish
live campaign delivery.
