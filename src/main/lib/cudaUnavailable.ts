/**
 * Recognise the "this machine has no usable CUDA" Python failure in a ComfyUI
 * stderr tail, and — the part that actually matters — work out whether it is
 * the reason the process died.
 *
 * On Apple Silicon (and any CPU-only install) torch is built without CUDA, so
 * anything that reaches torch's lazy CUDA init raises
 * `AssertionError: Torch not compiled with CUDA enabled`. Users read that as
 * "the installer shipped me a Windows/CUDA build" and file angry bug reports;
 * it is almost always third-party code assuming an NVIDIA GPU.
 *
 * The catch: ComfyUI wraps every custom-node import in `try/except Exception`
 * (`load_custom_node` in ComfyUI's `nodes.py`), logs the traceback, then logs
 * `Cannot import <path> module for custom nodes: <msg>` and keeps booting. So
 * this traceback appears in plenty of perfectly healthy Mac logs, and the
 * crash tail we capture is only the last N lines of stderr — a caught import
 * traceback can easily sit next to an unrelated fatal exit. Blaming the node
 * pack in that case would be actively wrong.
 *
 * Hence `handledByNodeImport`: when ComfyUI logged that it caught the error,
 * the pack was merely disabled and the process exited for some other reason.
 * Callers should not present a handled diagnosis as the cause of a crash.
 *
 * This module stays pure (string in, verdict out) so it is trivially testable.
 */

/** Python/torch errors that unambiguously mean "code asked for a CUDA GPU that
 *  this machine does not have". Deliberately narrow: a message that merely
 *  mentions CUDA (backend probes list it as unavailable on roughly half of all
 *  Mac boots) must not match, or we would blame nodes for healthy logs. */
const CUDA_UNAVAILABLE_ERRORS: readonly string[] = [
  // CPU/MPS build of torch — the macOS case. Raised from torch's lazy init.
  'Torch not compiled with CUDA enabled',
  // CUDA build, but no visible device (CPU-only Linux box, masked devices).
  'No CUDA GPUs are available',
  'Found no NVIDIA driver on your system',
  // Loading a checkpoint pickled on a CUDA device without `map_location`.
  'Attempting to deserialize object on a CUDA device'
]

/** ComfyUI's own log line proving it caught the error while importing a node
 *  pack. Emitted by `load_custom_node`'s outer `except Exception`. */
const CAUGHT_IMPORT_RE = /Cannot import (.+?) module for custom nodes/

/** A CPython traceback frame: `  File "/path/to/x.py", line 12, in <module>`. */
const TRACEBACK_FRAME_RE = /^\s*File "([^"]+)", line \d+/

/** The header CPython prints above a traceback's frames. Doubles as the upper
 *  bound when attributing frames, so two stacked tracebacks stay separate. */
const TRACEBACK_HEADER_RE = /^\s*Traceback \(most recent call last\):/

/**
 * How far past the error line to look for ComfyUI's "Cannot import" marker.
 * The traceback is logged as one record and the marker as the next, so in
 * practice the gap is a single line; allow a few more for log prefixes and
 * interleaved output from other threads without reaching into an unrelated
 * later import failure.
 */
const CAUGHT_MARKER_LOOKAHEAD = 5

export interface CudaUnavailableDiagnosis {
  /** The matched error text (not the whole line), e.g.
   *  `'Torch not compiled with CUDA enabled'`. */
  error: string
  /** Directory name of the implicated pack under `custom_nodes/`, when the
   *  failure came from one — e.g. `'ComfyUI-FramePackWrapper'`. Absent when the
   *  traceback has no `custom_nodes` frame (the failure was in ComfyUI itself
   *  or a site-package) or when the tail was truncated past the frames. */
  customNode?: string
  /** True when ComfyUI logged that it caught this while importing a node pack.
   *  A caught import error disables that pack and boot continues, so it did NOT
   *  kill the process — never report it as a crash cause. */
  handledByNodeImport: boolean
}

/** Extract the `custom_nodes/<pack>` directory name from a filesystem path, or
 *  `undefined` when the path isn't inside a node pack. Handles both separators
 *  because a Windows log can reach us on any platform. */
function nodePackFromPath(filePath: string): string | undefined {
  // Drop empty segments so a doubled or trailing separator can't make the pack
  // name come back as ''.
  const segments = filePath.split(/[/\\]+/).filter((s) => s.length > 0)
  const idx = segments.lastIndexOf('custom_nodes')
  if (idx === -1) return undefined
  const pack = segments[idx + 1]
  // `custom_nodes/foo.py` (single-file node) still names the pack usefully;
  // `custom_nodes/` with nothing after it does not.
  return pack && pack.length > 0 ? pack : undefined
}

/**
 * Diagnose a ComfyUI stderr tail for a CUDA-unavailable failure.
 *
 * Returns `null` when the tail shows no such error — including when it merely
 * mentions CUDA, which is normal on macOS.
 */
export function diagnoseCudaUnavailable(
  stderr: string | null | undefined
): CudaUnavailableDiagnosis | null {
  if (!stderr) return null
  const lines = stderr.split(/\r?\n/)

  // Scan from the end: with several tracebacks in one tail, the last one is the
  // one nearest the exit and so the best candidate for having caused it.
  let errorLine = -1
  let error = ''
  for (let i = lines.length - 1; i >= 0 && errorLine === -1; i--) {
    const line = lines[i] ?? ''
    for (const candidate of CUDA_UNAVAILABLE_ERRORS) {
      if (line.includes(candidate)) {
        errorLine = i
        error = candidate
        break
      }
    }
  }
  if (errorLine === -1) return null

  // Did ComfyUI catch it while importing a node pack? That line also names the
  // pack path directly, which beats guessing from the traceback frames.
  //
  // Start at `errorLine` itself, not the line after: ComfyUI's marker quotes
  // the exception message (`Cannot import <path> ...: Torch not compiled with
  // CUDA enabled`), so the backwards scan above lands on the marker rather than
  // on the `AssertionError:` line whenever both are in the tail.
  const end = Math.min(lines.length, errorLine + 1 + CAUGHT_MARKER_LOOKAHEAD)
  for (let i = errorLine; i < end; i++) {
    const caught = CAUGHT_IMPORT_RE.exec(lines[i] ?? '')
    if (caught) {
      return {
        error,
        customNode: nodePackFromPath(caught[1] ?? ''),
        handledByNodeImport: true
      }
    }
  }

  // Uncaught: attribute it to the deepest `custom_nodes` frame in the traceback
  // above the error. CPython prints frames outermost-first, so walking upwards
  // the first match is the innermost one — the frame closest to the failing
  // call, rather than the pack's entry point.
  //
  // Stop at the `Traceback (most recent call last):` header so a tail holding
  // several tracebacks can't attribute this error to a frame from an earlier,
  // unrelated one.
  let customNode: string | undefined
  for (let i = errorLine - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (TRACEBACK_HEADER_RE.test(line)) break
    const frame = TRACEBACK_FRAME_RE.exec(line)
    if (!frame) continue
    const pack = nodePackFromPath(frame[1] ?? '')
    if (pack) {
      customNode = pack
      break
    }
  }

  return { error, customNode, handledByNodeImport: false }
}
