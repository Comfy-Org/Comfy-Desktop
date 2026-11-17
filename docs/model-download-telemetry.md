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
| `result`     | The attempt ends with `completed`, `error`, or `cancelled` in the `result` property.  |

Progress updates produce no events. Joining an existing job and finding an already-present
model produce no new lifecycle. A paused download found on disk produces no events until it
is resumed or cancelled. A process exit can leave a started request without a terminal event.

Each event includes:

- `download_id`: a new random UUID, shared by this request's lifecycle. It is independent of
  filenames, URLs, installation IDs, and persisted job IDs. Retries and restored jobs receive
  new IDs. Use it to join events for one attempt.
- `installation_id` identifies the local build that requested the managed download. It matches
  the build ID on install completion and first successful execution. Restored jobs use the
  persisted ID when it still refers to a local build. Unattributed downloads use null.
- `source`: `comfyui`, `app`, `template`, `restored`, or `unknown`. Joined jobs retain the
  original request's source and build ID.
- `provider`: `huggingface`, `civitai`, or `other`, based on the original URL's host. Redirect
  destinations, private hostnames, URL paths, query strings, and credentials are never sent.
- `is_retry`: true for retry actions in Downloads and automatic template retries. Resuming a
  paused job is not a retry.
- `received_bytes`: the latest observed bytes present for the transfer, including retained
  bytes on resume. This is not cumulative network traffic across retries or range restarts.
- `total_bytes`: the expected file size, or null while unknown. A completion uses the verified
  final byte count for both byte fields.
- `directory_bucket`, `file_ext`, and `size_bucket` support the existing PostHog charts.
  They report a known directory category, supported file extension, and expected size range.
- `duration_ms`: wall-clock time since `started` in this process, including preparation and
  pauses. A restored job starts a new duration when resumed or cancelled.
- `resume_count`: within-process resumes since `started`.

Results with `error` additionally contain `error_bucket`, using the shared error buckets with download
categories `access_denied`, `http`, `checksum`, and `size_mismatch`. HTTP failures include a
numeric `http_status`. Error messages, stacks, model names, filenames, filesystem paths, hashes,
and authentication data are never properties of these events.

For the activation funnel, start with `comfy.desktop.install.completed` and look for
`comfy.desktop.execution.first_completed` on the same `installation_id` within the conversion window.
Use download starts with a `download_id` and that build ID after installation and before the first
successful run or the end of the window. Join each start to its result by `download_id` and compare
first-run conversion by observed download outcome, source, duration, and size. Use the same
conversion window for builds with and without recorded downloads.

Keep starts with missing results in an unknown outcome bucket. An in-progress download, process exit,
consent change, or telemetry limit can leave the start without a result. Consent changes can also leave
a result without a captured start. Retries and jobs restored after a restart have their own attempt IDs.
The telemetry client supplies app version and platform.

`comfyDownloadManagerTelemetry.test.ts` exercises the manager, transfer, staging, and consent gate
against a local HTTP server. It verifies that install completion, model downloads, and first successful
execution emit the same build ID. The Apps and template call-site tests verify source and retry metadata.
