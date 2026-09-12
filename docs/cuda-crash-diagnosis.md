# Diagnosing "no usable CUDA" crashes

On Apple Silicon and CPU-only installs, PyTorch is built without CUDA. Anything
reaching torch's lazy CUDA init dies with
`AssertionError: Torch not compiled with CUDA enabled`. Users reliably read this
as the installer having shipped them a Windows/CUDA build and report it as an
installer bug.

`src/main/lib/cudaUnavailable.ts` recognises the failure in a crash tail and
decides whether it is worth reporting. The recognising part is easy; the
deciding part is the whole reason the module exists.

## Two facts that constrain any fix here

**ComfyUI catches custom-node import failures.** `load_custom_node` in ComfyUI's
`nodes.py` wraps every pack import in `except Exception`, logs the traceback,
logs `Cannot import <path> module for custom nodes`, and keeps booting. A node
pack failing this way **cannot** bring ComfyUI down, so this traceback appears
in plenty of perfectly healthy Mac logs.

**The crash tail is only the last 100 lines of stderr.** So a caught import
traceback can sit next to an entirely unrelated fatal exit.

Together these mean naive detection produces confident, wrong accusations
against node packs. `handledByNodeImport` exists to suppress exactly that: when
ComfyUI's marker is present *and quotes the same error*, the pack was merely
disabled and the process died of something else.

Expect this diagnosis to fire **rarely**. If it starts firing often, the premise
is wrong, not the copy — go and find the real cause.

## Two exit paths, both wired

A fatal CUDA error happens while ComfyUI is still starting up, so the process
exits *before* the port is ready. That path never reaches the exit handler:

| when it dies | path | where the guidance is added |
| --- | --- | --- |
| before port-ready | launch failure | `_describeCudaFailure`, inlined into the early-exit message next to `describeExitCode`'s access-violation hint |
| after port-ready | crash | `diagnoseCrash` → `cudaUnavailable` on `ComfyExitedData` → `ComfyLifecycleView` |

Wiring only the crash path would have left the feature absent from the failure
it was written for. Both paths honour `handledByNodeImport`.

## Why the category exists

`CudaFailureCategory` (in `src/types/ipc.ts`) is not decoration — the same
message cannot be true for all of these:

| category | meaning | what the user should do |
| --- | --- | --- |
| `no-cuda-build` | torch has no CUDA support at all | on macOS: nothing, this is by design. Elsewhere: reinstall torch with CUDA |
| `no-cuda-device` | torch has CUDA, nothing usable answered | driver problem, or a GPU hidden from the process |
| `cuda-deserialize` | GPU-pickled checkpoint loaded without `map_location` | bug in whatever loaded the file |

`no-cuda-build` additionally splits on platform. "PyTorch is built without CUDA
by design, this is not a problem with your installer" is true on Apple Silicon
and the exact opposite of the truth on a Windows machine with an NVIDIA card,
where it means the wrong torch build is installed. Unknown platforms get the
non-Mac wording deliberately: suggesting a fix is a safer way to be wrong than
dismissing a real problem.

## Matching stays narrow on purpose

Only the phrasings in `CUDA_UNAVAILABLE_ERRORS` match. Backend probes report
CUDA as unavailable on roughly half of all healthy Mac boots, so a substring
match on `CUDA` would flag working installs.

Note also which torch calls actually raise. `torch.device('cuda')`,
`torch.cuda.memory_allocated()`, `max_memory_allocated()`, `memory_reserved()`,
`memory_stats()`, `empty_cache()` and `is_bf16_supported()` are silent no-ops
without a GPU — only calls reaching `_lazy_init` raise. Audits that count the
no-ops overstate the problem badly.

## Known offender

Every pack in the FramePack family vendors the same line in
`diffusers_helper/memory.py`, at module scope, so it runs at import:

```python
gpu = torch.device(f'cuda:{torch.cuda.current_device()}')
```

Upstream fixes: kijai/ComfyUI-FramePackWrapper#17,
tori29umai0123/ComfyUI-FramePackWrapper_PlusOne#5,
CY-CHENYUE/ComfyUI-FramePack-HY#5.
