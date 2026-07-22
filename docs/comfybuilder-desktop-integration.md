# ComfyBuilder Desktop Integration Documentation

This document outlines the ComfyBuilder integration within the Comfy Desktop application (Desktop2). It details the configuration values, environment overrides, and the critical OAuth registration prerequisites required for live end-to-end authentication.

---

## 1. Configuration Values and Environment Overrides

Comfy Desktop reads configuration from the environment at startup or falls back to internal defaults. The following parameters configure communication with ComfyBuilder and the OAuth identity provider:

### Base and API Endpoints

* **ComfyBuilder Base URL**
  * **Default Value**: `https://comfy-builder.fennec-typhon.ts.net`
  * **Environment Override**: `COMFYBUILDER_BASE_URL`
* **ComfyBuilder API Base**
  * **Default Value**: `<COMFYBUILDER_BASE_URL>/api/v1` (dynamically derived from the base URL)
  * **Environment Override**: Inherits changes to `COMFYBUILDER_BASE_URL`.

### OAuth Configuration Values

The OAuth flow is configured with the following properties:

* **OAuth Issuer**: `https://cloud.comfy.org`
* **Authorize URL**: `https://cloud.comfy.org/oauth/authorize`
* **Token URL**: `https://cloud.comfy.org/oauth/token`
* **JWKS URL**: `https://cloud.comfy.org/.well-known/jwks.json`
* **Client ID**: `comfy-builder-dev`
  * **Environment Override**: `COMFYBUILDER_OAUTH_CLIENT_ID`
* **Scope**: `comfy-cloud:user:read`
* **Resource**: `https://cloud.comfy.org/api`
* **Audience**: `comfy-cloud`

### Key Distinction: `aud` vs `resource`

The `resource` parameter and the token `audience` (aud) are two different strings:
* **Resource Parameter (`resource`)**: The frontend specifies `https://cloud.comfy.org/api`. During authorization, the issuer strips the host prefix and matches the remaining `/api` path against the configured database schema to locate the resource.
* **Token Audience (`aud`)**: The minted token carries the literal audience claim `comfy-cloud` (matching the resource's `audience` identifier column).
* The ComfyBuilder backend expects `OAUTH_AUDIENCE=comfy-cloud` to validate inbound requests. Setting `OAUTH_AUDIENCE` to the full URI string causes a validation mismatch and rejects API requests with a 401 response.

---

## 2. OAuth Registration Prerequisite (Critical)

For end-to-end live login to succeed, Comfy Desktop requires a registered OAuth client definition on the identity provider.

### Prerequisite Section

* **Prerequisite**: The loopback redirect URI pattern `http://127.0.0.1:{port}/callback` must be registered in the Comfy Cloud database under the `oauth_clients` table. Specifically, the client's `redirect_uris` JSON array must contain the exact redirect target, and the row must associate with a Desktop-usable `client_id`.
* **No Self-Provisioning**: The Desktop client cannot provision this registration at runtime. The configuration requires manual database access or admin action on the Comfy Cloud infrastructure.
* **Reference**: For database schema definitions and registration insert templates, consult `ComfyBuilder/docs/comfybuilder-oauth-registration-playbook.md`.
* **Important Note**: Automated test suites use a simulated mock identity issuer. Real end-to-end user login requires the loopback redirect registration described above.

---

## 3. Reference Files and Diagnostics

Additional context on Tailscale setup and local OAuth mechanics can be found in `ComfyBuilder/docs/local-oauth-setup.md`.
