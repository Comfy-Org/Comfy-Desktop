# Customer.io messages in Desktop

Desktop loads the Customer.io browser SDK into the eligible, visible body of a
focused window. The main process owns the session and confirms all of the following:

- The user has enabled Desktop telemetry.
- The window is visible and focused, with no onboarding/progress takeover or
  feedback, MCP, or announcement overlay.
- Local ComfyUI has affirmed the Firebase UID verified by Desktop's authentication
  flow, and the other authentication reporters agree; or the launcher has resolved
  its OAuth identity through authenticated `GET /api/user`.
- The launcher has completed first-use onboarding and is the exact bundled panel
  document (or the configured development server's panel).

Signing out, changing accounts, revoking consent, leaving ComfyUI, or hiding its
window clears the messaging session and removes visible messages. Switching
surfaces revokes the old document before granting the new one. Onboarding,
remote ComfyUI pages, and embedded Cloud do not receive Desktop's SDK. Embedded
Cloud continues to own its existing integration.

## Campaign configuration

The default public browser keys in `src/shared/customerIo.ts` use the existing
Cloud Customer.io source. Desktop sends `identify` with the selected locale,
a synthetic page name, and the SDK's delivery/interaction metrics.

| Page name | Surface | Identity |
| --- | --- | --- |
| `desktop/comfyui` | Local ComfyUI workflow interface | Desktop-verified local Firebase UID |
| `desktop/launcher` | Launcher chooser, stopped-instance page and installation forms | Authenticated OAuth grant's Firebase UID |

These names identify UI surfaces, not particular installations or workflow files.
Page properties also use the synthetic target rather than a local URL.

Configure Desktop messages to match that page name. Audit campaigns with no page
restriction before rollout: those can match Desktop users too. Native HTTP(S) and
email message actions open externally; opening a message link must leave the
ComfyUI workflow in place.

## Launcher identity dependency

Launcher OAuth uses a canonical Cloud person ID, which can differ from the
Firebase UID used by existing Customer.io profiles. Desktop consumes only the
optional `firebase_uid` returned by authenticated `/api/user`; it never guesses
from the canonical ID, workspace ID, email, or unverified JWT claims.

This requires Cloud's [OAuth provenance layer](https://github.com/Comfy-Org/cloud/pull/9467)
and [authenticated identity response](https://github.com/Comfy-Org/cloud/pull/9468).
Existing OAuth grants without provenance need a fresh sign-in before launcher
messaging can activate. The API omits the field if the original Firebase subject
no longer maps to the authenticated canonical account. Local ComfyUI's existing
verified Firebase flow continues to work independently.

Launcher lookups are revalidated on activation and credential changes. Logout,
workspace switches, window/view replacement, or consent changes cannot apply a
late response from an obsolete lookup. No live Customer.io profiles are migrated.

## Runtime and development

Packaged builds enable messaging when the eligibility conditions above hold.
Development builds default off. Environment overrides:

| Variable                                 | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `COMFY_CUSTOMER_IO_ENABLED=true`         | Enable messaging during development            |
| `COMFY_CUSTOMER_IO_ENABLED=false` or `0` | Disable messaging for this process             |
| `COMFY_CUSTOMER_IO_WRITE_KEY`            | Override the public Data Pipelines browser key |
| `COMFY_CUSTOMER_IO_SITE_ID`              | Override the public in-app site ID             |

The browser SDK is bundled as a script and executed in the selected browser context.
It receives no Node access. Its location and local/session storage accesses are
redirected at build time to a private synthetic URL and in-memory stores. This
applies before SDK initialization, so URL parameters cannot select an identity,
trigger events, or add campaign/referrer metadata. The SDK's fallback route uses
the synthetic surface path, never the real workflow path. Native link handling owns
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

Use `windows` or `linux` for the corresponding host. These tests run both shipped
preloads and the real SDK with intercepted responses and disposable identities.
The launcher fixture uses a file URL and the production panel's CSP.
It covers rendering, opened metrics, dismissal, account changes, revocation, and
continued access to the workflow and its existing browser storage.

Unit tests cover main-process eligibility, frame validation, link handling,
authentication consensus, and asynchronous session changes.

Release verification still needs a restricted live Customer.io campaign and
packaged macOS/Windows checks. Confirm the intended profile receives a message in
both launcher and local ComfyUI, its delivery/open/click records appear, links preserve the workflow,
and embedded Cloud does not receive a second SDK. Fixture results do not establish
live campaign delivery.
