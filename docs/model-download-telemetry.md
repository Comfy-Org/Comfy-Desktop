# Model download telemetry

The shared model download manager records `comfy.desktop.model_download.*` events for
downloads requested by hosted ComfyUI, Apps, and template tasks. These use the existing
main-process PostHog client, consent gate, privacy scrubbing, and volume limits. They do not
include general file downloads, generated assets, or installation archives.

| Event suffix | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `started`    | A new request needs a model download, including requests rejected during preparation. |
| `paused`     | An active request pauses, including user pauses and sleep/quit suspension.            |
| `resumed`    | A paused request resumes within the same process.                                     |
| `completed`  | The verified file is installed at its final destination.                              |
| `failed`     | Preparation, transfer, verification, or final placement failed.                       |
| `cancelled`  | The request was cancelled or its parked job was released.                             |

Progress updates produce no events. Joining an existing job and finding an already-present
model produce no new lifecycle. A paused download found on disk produces no events until it
is resumed or cancelled. A process exit can leave a started request without a terminal event.

Each event includes:

- `download_id`: a new random UUID, shared by this request's lifecycle. It is independent of
  filenames, URLs, installation IDs, and persisted job IDs. Retries and restored jobs receive
  new IDs; this is an attempt-level join key, not a persistent model identifier.
- `source`: `comfyui`, `app`, `template`, `restored`, or `unknown`. Joined jobs retain the
  original request's source. Restored jobs cannot recover their original source.
- `provider`: `huggingface`, `civitai`, or `other`, based on the original URL's host. Redirect
  destinations, private hostnames, URL paths, query strings, and credentials are never sent.
- `is_retry`: true for retry actions in Downloads and automatic template retries. Resuming a
  paused job is not a retry.
- `received_bytes`: the latest observed bytes present for the transfer, including retained
  bytes on resume. This is not cumulative network traffic across retries or range restarts.
- `total_bytes`: the expected file size, or null while unknown. A completion uses the verified
  final byte count for both byte fields.
- `duration_ms`: wall-clock time since `started` in this process, including preparation and
  pauses. A restored job starts a new duration when resumed or cancelled.
- `resume_count`: within-process resumes since `started`.

Failures additionally contain `error_bucket`, using the shared error buckets with download
categories `access_denied`, `http`, `checksum`, and `size_mismatch`. HTTP failures include a
numeric `http_status`. Error messages, stacks, model names, filenames, filesystem paths, hashes,
and authentication data are never properties of these events.

For activation analysis, join lifecycle events by `download_id`, segment by `source`, and compare
completion/cancellation/failure rates, duration and file sizes. Separate retries using `is_retry`
and pause-heavy attempts using `resume_count`. Missing terminal events can mean an in-progress
download, process exit, consent change, or telemetry limits; they are not necessarily failures.
Consent changes can also leave terminal events without a captured start. Existing app version,
platform, and installation properties are attached centrally by the telemetry client.

`comfyDownloadManagerTelemetry.test.ts` exercises the real manager, transfer, staging files, and
consent gate against a local HTTP server; only Electron's request adapter and the PostHog transport
are substituted. The Apps and template call-site tests verify their source and retry metadata.
