import { describe, expect, it } from 'vitest'
import { scrubAll, scrubPaths } from './piiScrub'
import type { PathRoot } from './piiScrub'

const WINDOWS_ROOTS: PathRoot[] = [
  { path: 'D:\\AI Stuff\\Comfy\\ComfyUI', token: '<comfyui>' },
  { path: 'D:\\AI Stuff\\Comfy', token: '<install>' }
]
const POSIX_ROOTS: PathRoot[] = [
  { path: '/home/alice/Comfy/ComfyUI', token: '<comfyui>' },
  { path: '/home/alice/Comfy', token: '<install>' }
]
const MAC_ROOTS: PathRoot[] = [
  { path: '/Users/alice/Documents/Comfy Desktop/ComfyUI', token: '<comfyui>' },
  { path: '/Users/alice/Documents/Comfy Desktop', token: '<install>' }
]

describe('scrubPaths', () => {
  describe('paths inside a known root', () => {
    it.each([
      [
        'a Windows traceback frame, with spaces in the root',
        '  File "D:\\AI Stuff\\Comfy\\ComfyUI\\custom_nodes\\pack\\nodes.py", line 12, in run',
        '  File "<comfyui>/custom_nodes/pack/nodes.py", line 12, in run',
        WINDOWS_ROOTS
      ],
      [
        'the managed venv, case-folded as Windows resolves it',
        '  File "d:\\ai stuff\\comfy\\.venv\\Lib\\site-packages\\torch\\nn.py", line 3, in f',
        '  File "<install>/.venv/Lib/site-packages/torch/nn.py", line 3, in f',
        WINDOWS_ROOTS
      ],
      [
        'forward slashes and a Python-repr doubled backslash',
        "open('D:/AI Stuff/Comfy/ComfyUI\\\\models\\\\x.ckpt')",
        "open('<comfyui>/models/x.ckpt')",
        WINDOWS_ROOTS
      ],
      [
        'an unquoted Windows path with spaces in the root',
        'Loading D:\\AI Stuff\\Comfy\\ComfyUI\\models\\x.ckpt took 3s',
        'Loading <comfyui>/models/x.ckpt took 3s',
        WINDOWS_ROOTS
      ],
      [
        'a Linux warning location',
        '/home/alice/Comfy/ComfyUI/nodes.py:12: UserWarning: deprecated',
        '<comfyui>/nodes.py:12: UserWarning: deprecated',
        POSIX_ROOTS
      ],
      [
        'a macOS frame under a root with a space',
        '  File "/Users/alice/Documents/Comfy Desktop/.venv/lib/python3.12/site.py", line 1',
        '  File "<install>/.venv/lib/python3.12/site.py", line 1',
        MAC_ROOTS
      ],
      [
        'a file:// URL',
        'see file:///home/alice/Comfy/ComfyUI/web/index.html',
        'see <comfyui>/web/index.html',
        POSIX_ROOTS
      ],
      ['the root itself', 'cwd=/home/alice/Comfy', 'cwd=<install>', POSIX_ROOTS]
    ])('keeps %s readable', (_label, input, expected, roots) => {
      expect(scrubPaths(input, roots)).toBe(expected)
    })
  })

  describe('paths outside every root', () => {
    it.each([
      ['another drive', "No such file or directory: 'E:\\\\models\\\\my lora.safetensors'"],
      ['an unquoted path with spaces', 'Loading E:\\Other Stuff\\x.ckpt took 3s'],
      ['Program Files', 'C:\\Program Files (x86)\\Thing\\a.dll missing'],
      ['a UNC share', 'open \\\\nas\\share\\models\\a.safetensors failed'],
      ['a long-path prefix', 'at \\\\?\\C:\\Users\\bob\\x.py'],
      ['a file:// URL', 'see file:///C:/Users/bob/x.html'],
      ['a mount', 'reading /mnt/data/models/a.pt'],
      ['a home-relative path', 'config at ~/secret/x.yaml'],
      ['a sibling of the root', 'at /home/alice/Comfy2/x.py'],
      ['a macOS path with spaces', 'db /Users/bob/Library/Application Support/x.db'],
      ['a file name with spaces', 'Loading E:\\models\\Acme Client Secret Project v2.safetensors'],
      ['an apostrophe in a quoted path', '  File "C:\\Users\\Sean O\'Brien\\Secret\\x.py", line 1'],
      ['every entry of a path list', 'LD_LIBRARY_PATH=/usr/lib:/mnt/clientx/secret/lib'],
      ['a forward-slash UNC share', 'open //nas/share/secret/a.pt failed'],
      ['a long-path UNC share', 'open \\\\?\\UNC\\nas\\share\\secret\\a.pt'],
      ['an NTFS stream name', 'E:\\models\\file:secret.safetensors'],
      ['a root escaped with ..', 'at /home/alice/Comfy/ComfyUI/../../secret/x.py']
    ])('redacts %s', (_label, input) => {
      const scrubbed = scrubPaths(input, [...WINDOWS_ROOTS, ...POSIX_ROOTS])
      expect(scrubbed).toContain('<path>')
      for (const leak of [
        'bob',
        'Brien',
        'models',
        'nas',
        'Thing',
        'secret',
        'Secret',
        'Stuff',
        'Comfy2',
        'clientx'
      ]) {
        expect(scrubbed).not.toContain(leak)
      }
    })

    it('redacts every absolute path when no roots are known', () => {
      expect(scrubPaths('  File "/home/alice/Comfy/ComfyUI/main.py", line 1')).toBe(
        '  File "<path>", line 1'
      )
    })

    it('keeps a line number and message after a colon, and closing punctuation', () => {
      expect(scrubPaths('/a/b.py:12: UserWarning: hi')).toBe('<path>:12: UserWarning: hi')
      expect(scrubPaths('open E:\\x.ckpt: denied')).toBe('open <path>: denied')
      expect(scrubPaths('at fn (/Users/bob/x.js:3:9)')).toBe('at fn (<path>:3:9)')
      expect(scrubPaths('[/Users/bob/x.py]')).toBe('[<path>]')
    })

    it('redacts the prose after an unquoted outside path, since it may be the file name', () => {
      expect(scrubPaths('Loading E:\\x.ckpt took 3s')).toBe('Loading <path>')
    })
  })

  describe('text that is not an absolute path', () => {
    it.each([
      'https://example.com/a/b?c=1',
      'http://127.0.0.1:8188/api/prompt',
      'ratio 1/2 and/or route api/prompt',
      'relative custom_nodes/pack/nodes.py',
      'torch 2.8.0+cu128'
    ])('leaves %s alone', (input) => {
      expect(scrubPaths(input, POSIX_ROOTS)).toBe(input)
    })
  })

  it('is stable under a second pass, with or without roots', () => {
    const once = scrubPaths(
      '  File "/home/alice/Comfy/ComfyUI/a.py", line 1\nat /tmp/x\nat /home/alice/Comfy/ComfyUI/b c.py',
      POSIX_ROOTS
    )
    expect(once).toBe('  File "<comfyui>/a.py", line 1\nat <path>\nat <comfyui>/b c.py')
    expect(scrubPaths(once)).toBe(once)
    expect(scrubPaths(once, POSIX_ROOTS)).toBe(once)
  })

  it('matches the root before scrubAll rewrites its username', () => {
    const text = 'at C:\\Users\\alice\\Comfy\\ComfyUI\\main.py'
    const roots = [{ path: 'C:\\Users\\alice\\Comfy\\ComfyUI', token: '<comfyui>' }]
    expect(scrubAll(scrubPaths(text, roots))).toBe('at <comfyui>/main.py')
  })
})
