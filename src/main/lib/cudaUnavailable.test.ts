import { describe, expect, it } from 'vitest'

import { diagnoseCudaUnavailable } from './cudaUnavailable'

/**
 * The shape ComfyUI actually logs when a node pack asks for CUDA at import time
 * on a machine without it. Modelled on ComfyUI-FramePackWrapper, whose vendored
 * `diffusers_helper/memory.py` runs `torch.cuda.current_device()` at module
 * scope. `load_custom_node` catches this, so boot continues.
 */
const CAUGHT_IMPORT_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "/Users/gp/ComfyUI/nodes.py", line 2263, in load_custom_node',
  '    module_spec.loader.exec_module(module)',
  '  File "<frozen importlib._bootstrap_external>", line 999, in exec_module',
  '  File "/Users/gp/ComfyUI/custom_nodes/ComfyUI-FramePackWrapper/__init__.py", line 1, in <module>',
  '    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS',
  '  File "/Users/gp/ComfyUI/custom_nodes/ComfyUI-FramePackWrapper/nodes.py", line 22, in <module>',
  '    from .diffusers_helper.memory import DynamicSwapInstaller',
  '  File "/Users/gp/ComfyUI/custom_nodes/ComfyUI-FramePackWrapper/diffusers_helper/memory.py", line 8, in <module>',
  "    gpu = torch.device(f'cuda:{torch.cuda.current_device()}')",
  '  File "/Users/gp/ComfyUI/venv/lib/python3.12/site-packages/torch/cuda/__init__.py", line 1026, in current_device',
  '    _lazy_init()',
  '  File "/Users/gp/ComfyUI/venv/lib/python3.12/site-packages/torch/cuda/__init__.py", line 363, in _lazy_init',
  '    raise AssertionError("Torch not compiled with CUDA enabled")',
  'AssertionError: Torch not compiled with CUDA enabled',
  'Cannot import /Users/gp/ComfyUI/custom_nodes/ComfyUI-FramePackWrapper module for custom nodes: Torch not compiled with CUDA enabled'
].join('\n')

/** The same failure with no `Cannot import` marker — i.e. it escaped the
 *  custom-node import guard and really did take the process down. */
const FATAL_TRACEBACK = CAUGHT_IMPORT_TRACEBACK.split('\n').slice(0, -1).join('\n')

describe('diagnoseCudaUnavailable', () => {
  it('returns null for stderr with no CUDA failure', () => {
    expect(diagnoseCudaUnavailable('Total VRAM 0 MB\nUsing sub quadratic optimization')).toBeNull()
  })

  it('returns null for empty or absent stderr', () => {
    expect(diagnoseCudaUnavailable('')).toBeNull()
    expect(diagnoseCudaUnavailable(null)).toBeNull()
    expect(diagnoseCudaUnavailable(undefined)).toBeNull()
  })

  it('does not match a log that merely mentions CUDA', () => {
    // Roughly half of healthy Mac boots print lines like these while probing
    // backends. Matching them would blame node packs for working installs.
    const healthy = [
      'Checkpoint files will always be loaded safely.',
      'xformers version: not installed',
      'CUDA is not available, falling back to MPS',
      'Device: mps',
      'Torch version: 2.6.0'
    ].join('\n')
    expect(diagnoseCudaUnavailable(healthy)).toBeNull()
  })

  it('flags a caught custom-node import as handled, not a crash cause', () => {
    const result = diagnoseCudaUnavailable(CAUGHT_IMPORT_TRACEBACK)
    expect(result).toEqual({
      error: 'Torch not compiled with CUDA enabled',
      category: 'no-cuda-build',
      customNode: 'ComfyUI-FramePackWrapper',
      handledByNodeImport: true
    })
  })

  it('attributes an uncaught failure to the deepest custom_nodes frame', () => {
    // torch's own frames are deeper but are not the culprit; the pack is.
    const result = diagnoseCudaUnavailable(FATAL_TRACEBACK)
    expect(result).toEqual({
      error: 'Torch not compiled with CUDA enabled',
      category: 'no-cuda-build',
      customNode: 'ComfyUI-FramePackWrapper',
      handledByNodeImport: false
    })
  })

  it('reports no custom node when the failure is not inside a node pack', () => {
    const coreFailure = [
      'Traceback (most recent call last):',
      '  File "/Users/gp/ComfyUI/main.py", line 140, in <module>',
      '    torch.cuda.set_device(0)',
      'AssertionError: Torch not compiled with CUDA enabled'
    ].join('\n')
    expect(diagnoseCudaUnavailable(coreFailure)).toEqual({
      error: 'Torch not compiled with CUDA enabled',
      category: 'no-cuda-build',
      customNode: undefined,
      handledByNodeImport: false
    })
  })

  it('does not borrow frames from an earlier unrelated traceback', () => {
    // A truncated tail can hold two tracebacks. The CUDA one here has no
    // custom_nodes frame of its own, so nothing should be blamed — even though
    // a node pack appears in the traceback above it.
    const stacked = [
      'Traceback (most recent call last):',
      '  File "/Users/gp/ComfyUI/custom_nodes/SomeOtherPack/nodes.py", line 3, in <module>',
      "ImportError: No module named 'cv2'",
      'Traceback (most recent call last):',
      '  File "/Users/gp/ComfyUI/main.py", line 140, in <module>',
      'AssertionError: Torch not compiled with CUDA enabled'
    ].join('\n')
    expect(diagnoseCudaUnavailable(stacked)?.customNode).toBeUndefined()
  })

  it('picks the traceback nearest the exit when several are present', () => {
    const stacked = [
      CAUGHT_IMPORT_TRACEBACK,
      'Traceback (most recent call last):',
      '  File "/Users/gp/ComfyUI/custom_nodes/ComfyUI-WanVideoWrapper/nodes_sampler.py", line 1738, in process',
      '    torch.cuda.reset_peak_memory_stats()',
      'AssertionError: Torch not compiled with CUDA enabled'
    ].join('\n')
    const result = diagnoseCudaUnavailable(stacked)
    expect(result?.customNode).toBe('ComfyUI-WanVideoWrapper')
    expect(result?.handledByNodeImport).toBe(false)
  })

  it('recognises the other CUDA-unavailable phrasings, each with its category', () => {
    // The categories drive which advice the UI gives, so pin every one of them:
    // "no CUDA build" and "no CUDA device" need opposite fixes.
    expect(diagnoseCudaUnavailable('RuntimeError: No CUDA GPUs are available')).toMatchObject({
      error: 'No CUDA GPUs are available',
      category: 'no-cuda-device'
    })
    expect(
      diagnoseCudaUnavailable('RuntimeError: Found no NVIDIA driver on your system.')
    ).toMatchObject({
      error: 'Found no NVIDIA driver on your system',
      category: 'no-cuda-device'
    })
    expect(
      diagnoseCudaUnavailable(
        'RuntimeError: Attempting to deserialize object on a CUDA device but torch.cuda.is_available() is False.'
      )
    ).toMatchObject({
      error: 'Attempting to deserialize object on a CUDA device',
      category: 'cuda-deserialize'
    })
    expect(
      diagnoseCudaUnavailable('AssertionError: Torch not compiled with CUDA enabled')
    ).toMatchObject({ category: 'no-cuda-build' })
  })

  it('does not treat an unrelated caught import as handling this error', () => {
    // A different pack failing for its own reason must not land inside the
    // lookahead window and silence a real CUDA crash. ComfyUI's marker always
    // quotes the exception it caught, so requiring the match is safe.
    const stderr = [
      'Traceback (most recent call last):',
      '  File "/Users/gp/ComfyUI/main.py", line 140, in <module>',
      'AssertionError: Torch not compiled with CUDA enabled',
      "Cannot import /Users/gp/ComfyUI/custom_nodes/SomeOtherPack module for custom nodes: No module named 'cv2'"
    ].join('\n')
    const result = diagnoseCudaUnavailable(stderr)
    expect(result?.handledByNodeImport).toBe(false)
    expect(result?.customNode).toBeUndefined()
  })

  it('handles Windows-style paths in the traceback', () => {
    const win = [
      'Traceback (most recent call last):',
      '  File "C:\\ComfyUI\\custom_nodes\\ComfyUI-FramePack-HY\\diffusers_helper\\memory.py", line 8, in <module>',
      'AssertionError: Torch not compiled with CUDA enabled'
    ].join('\n')
    expect(diagnoseCudaUnavailable(win)?.customNode).toBe('ComfyUI-FramePack-HY')
  })

  it('survives a tail truncated above the traceback frames', () => {
    // `lastStderr` keeps only the last N lines, so the frames may be gone.
    const truncated = [
      '    _lazy_init()',
      'AssertionError: Torch not compiled with CUDA enabled'
    ].join('\n')
    expect(diagnoseCudaUnavailable(truncated)).toEqual({
      error: 'Torch not compiled with CUDA enabled',
      category: 'no-cuda-build',
      customNode: undefined,
      handledByNodeImport: false
    })
  })
})
