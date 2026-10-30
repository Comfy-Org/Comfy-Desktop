import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeExceptionContext,
  scrubAll,
  scrubPII,
  scrubSecrets,
  setScrubbedHomeDir
} from './piiScrub'

describe('piiScrub', () => {
  describe('scrubPII', () => {
    it('redacts Windows user directory names', () => {
      expect(scrubPII('Error reading C:\\Users\\alice\\Documents\\foo.txt')).toBe(
        'Error reading C:\\Users\\[REDACTED]\\Documents\\foo.txt'
      )
    })

    it('redacts macOS home directory names', () => {
      expect(scrubPII('open /Users/jane/Library/Application Support/comfy')).toBe(
        'open /Users/[REDACTED]/Library/Application Support/comfy'
      )
    })

    it('redacts Linux home directory names', () => {
      expect(scrubPII('cat /home/bob/.config/comfy/settings.json')).toBe(
        'cat /home/[REDACTED]/.config/comfy/settings.json'
      )
    })

    it('redacts doubled-backslash Windows paths from JSON-escaped text', () => {
      const stderr = JSON.stringify({ path: 'C:\\Users\\alice\\ComfyUI\\main.py' })
      expect(stderr).toContain('C:\\\\Users\\\\alice')
      expect(scrubPII(stderr)).toBe('{"path":"C:\\\\Users\\\\[REDACTED]\\\\ComfyUI\\\\main.py"}')
    })

    it('keeps the JSON framing after a path that ends at the username', () => {
      expect(scrubPII('{"cwd":"C:\\\\Users\\\\alice","home":"/home/bob","n":1}')).toBe(
        '{"cwd":"C:\\\\Users\\\\[REDACTED]","home":"/home/[REDACTED]","n":1}'
      )
    })

    it('stops at a line break so the next stderr line survives', () => {
      expect(scrubPII('failed to create /home/bob\nCaused by: Permission denied')).toBe(
        'failed to create /home/[REDACTED]\nCaused by: Permission denied'
      )
    })

    it('redacts a username containing a space in full', () => {
      expect(scrubPII('C:\\Users\\Alice Smith\\x')).toBe('C:\\Users\\[REDACTED]\\x')
    })

    it('keeps the JSON framing after a /Users/ path', () => {
      expect(scrubPII('{"home":"/Users/alice","n":1}')).toBe('{"home":"/Users/[REDACTED]","n":1}')
    })

    it('leaves a quoted path that ends at the profile root intact', () => {
      expect(scrubPII('{"path":"C:\\\\Users\\\\","n":1}')).toBe('{"path":"C:\\\\Users\\\\","n":1}')
    })

    it('redacts a non-ASCII username written as JSON \\u escapes', () => {
      expect(scrubPII('"C:\\\\Users\\\\Bj\\u00f6rn\\\\AppData"')).toBe(
        '"C:\\\\Users\\\\[REDACTED]\\\\AppData"'
      )
    })

    it.each([
      ['/home/zo\\u00eb/x', '\\u00eb'],
      ['"C:/Users/\\u674e\\u5c0f\\u9f99/x"', '\\u5c0f'],
      ['"\\/Users\\/Bj\\u00f6rn\\/x"', '\\u00f6rn']
    ])('redacts a JSON-escaped non-ASCII name after a forward slash: %s', (input, tail) => {
      const scrubbed = scrubPII(input)
      expect(scrubbed).toContain('[REDACTED]')
      expect(scrubbed).not.toContain(tail)
    })

    it('redacts every occurrence of the same spelling', () => {
      const traceback = [
        'File "/home/bob/a.py", line 1',
        'File "/home/bob/b.py", line 2',
        'File "C:\\Users\\alice\\a.py", line 3',
        'File "C:\\Users\\alice\\b.py", line 4',
        'File "C:\\Users\\alice\\c.py", line 5'
      ].join('\n')
      const scrubbed = scrubPII(traceback)
      expect(scrubbed).not.toContain('bob')
      expect(scrubbed).not.toContain('alice')
      expect(scrubbed.match(/\[REDACTED\]/g)).toHaveLength(5)
    })

    it('keeps a raw folder whose name looks like a JSON escape', () => {
      expect(scrubPII('C:\\Users\\alice\\u1234\\x')).toBe('C:\\Users\\[REDACTED]\\u1234\\x')
    })

    it.each([
      'C:\\ComfyUI\\custom_nodes\\x\\home\\config.json',
      'C:\\ComfyUI\\custom_nodes\\x\\Users\\config.json',
      'C:\\\\ComfyUI\\\\custom_nodes\\\\x\\\\Users\\\\config.json'
    ])('leaves the nested project folder in %s alone', (input) => {
      expect(scrubPII(input)).toBe(input)
    })

    it.each([
      ['admin share', '\\\\server\\c$\\Users\\alice\\x', '\\\\server\\c$\\Users\\[REDACTED]\\x'],
      [
        'long UNC',
        '\\\\?\\UNC\\server\\Users\\alice\\x',
        '\\\\?\\UNC\\server\\Users\\[REDACTED]\\x'
      ],
      ['long drive', '\\\\?\\C:\\Users\\alice\\x', '\\\\?\\C:\\Users\\[REDACTED]\\x'],
      [
        'device path',
        '\\Device\\HarddiskVolume3\\Users\\alice',
        '\\Device\\HarddiskVolume3\\Users\\[REDACTED]'
      ],
      ['root-relative', 'open \\Users\\alice\\x', 'open \\Users\\[REDACTED]\\x'],
      ['doubled root-relative', '"\\\\Users\\\\alice\\\\x"', '"\\\\Users\\\\[REDACTED]\\\\x"']
    ])('redacts a backslash-rooted %s Users path', (_label, input, expected) => {
      expect(scrubPII(input)).toBe(expected)
    })

    it('redacts the segment after a /users/ URL path', () => {
      expect(scrubPII('https://api.example.com/users/me/keys')).toBe(
        'https://api.example.com/users/[REDACTED]/keys'
      )
    })

    it('redacts a username containing an apostrophe in full', () => {
      expect(scrubPII("C:\\Users\\o'brien\\x")).toBe('C:\\Users\\[REDACTED]\\x')
    })

    it('redacts doubled-backslash Windows paths from a Python repr', () => {
      expect(scrubPII("FileNotFoundError: 'D:\\\\Users\\\\alice\\\\models'")).toBe(
        "FileNotFoundError: 'D:\\\\Users\\\\[REDACTED]\\\\models'"
      )
    })

    it.each([
      ['forward slashes', 'C:/Users/alice/ComfyUI', 'C:/Users/[REDACTED]/ComfyUI'],
      ['mixed separators', 'C:\\Users/alice\\ComfyUI', 'C:\\Users/[REDACTED]\\ComfyUI'],
      ['another drive letter', 'e:\\Users\\alice\\x', 'e:\\Users\\[REDACTED]\\x'],
      ['lowercase users', 'c:\\users\\alice\\x', 'c:\\users\\[REDACTED]\\x'],
      ['8.3 short name', 'C:\\Users\\ALICEB~1\\AppData', 'C:\\Users\\[REDACTED]\\AppData'],
      [
        'legacy profile root',
        'C:\\Documents and Settings\\alice\\x',
        'C:\\Documents and Settings\\[REDACTED]\\x'
      ],
      ['path ending at the username', 'cwd=C:\\Users\\alice', 'cwd=C:\\Users\\[REDACTED]'],
      [
        'JSON-escaped forward slashes',
        '"\\/Users\\/jane\\/Library"',
        '"\\/Users\\/[REDACTED]\\/Library"'
      ],
      [
        'doubled-backslash UNC',
        '\\\\\\\\fileserver\\\\Users\\\\alice\\\\x',
        '\\\\\\\\fileserver\\\\Users\\\\[REDACTED]\\\\x'
      ]
    ])('redacts Windows user directories with %s', (_label, input, expected) => {
      expect(scrubPII(input)).toBe(expected)
    })

    it('leaves paths without user segments untouched', () => {
      expect(scrubPII('/opt/comfy/bin/comfyui')).toBe('/opt/comfy/bin/comfyui')
    })
  })

  describe('setScrubbedHomeDir', () => {
    afterEach(() => setScrubbedHomeDir(''))

    it('redacts a relocated profile directory in every separator spelling', () => {
      setScrubbedHomeDir('D:\\Profiles\\alice')
      expect(scrubPII('D:\\Profiles\\alice\\ComfyUI')).toBe('D:\\Profiles\\[REDACTED]\\ComfyUI')
      expect(scrubPII('d:/profiles/ALICE/ComfyUI')).toBe('d:/profiles/[REDACTED]/ComfyUI')
      expect(scrubPII('"D:\\\\Profiles\\\\alice\\\\x"')).toBe('"D:\\\\Profiles\\\\[REDACTED]\\\\x"')
      expect(scrubPII("open 'D:\\Profiles\\alice'")).toBe("open 'D:\\Profiles\\[REDACTED]'")
    })

    it.each(['alicebrown', 'alice.smith', 'alice-old', 'alice~1', 'alice$'])(
      'does not redact the sibling directory %s',
      (sibling) => {
        setScrubbedHomeDir('D:\\Profiles\\alice')
        expect(scrubPII(`D:\\Profiles\\${sibling}\\x`)).toBe(`D:\\Profiles\\${sibling}\\x`)
      }
    )

    it.each([
      ['cwd=D:\\Profiles\\alice', 'cwd=D:\\Profiles\\[REDACTED]'],
      ['open D:\\Profiles\\alice failed', 'open D:\\Profiles\\[REDACTED] failed'],
      ['cannot open <D:\\Profiles\\alice>', 'cannot open <D:\\Profiles\\[REDACTED]>'],
      ['`D:\\Profiles\\alice`', '`D:\\Profiles\\[REDACTED]`'],
      ['D:\\Profiles\\alice|x', 'D:\\Profiles\\[REDACTED]|x'],
      ['D:\\Profiles\\alice>dir', 'D:\\Profiles\\[REDACTED]>dir'],
      ['D:\\Profiles\\alice&&x', 'D:\\Profiles\\[REDACTED]&&x'],
      ['D:\\Profiles\\alice!', 'D:\\Profiles\\[REDACTED]!'],
      ['D:\\Profiles\\alice*', 'D:\\Profiles\\[REDACTED]*']
    ])('redacts the home directory in %s', (input, expected) => {
      setScrubbedHomeDir('D:\\Profiles\\alice')
      expect(scrubPII(input)).toBe(expected)
    })

    it('redacts every occurrence of the registered home directory', () => {
      setScrubbedHomeDir('D:\\Profiles\\alice')
      expect(scrubPII('D:\\Profiles\\alice\\a and D:\\Profiles\\alice\\b')).toBe(
        'D:\\Profiles\\[REDACTED]\\a and D:\\Profiles\\[REDACTED]\\b'
      )
    })

    it('redacts the home directory at the end of a sentence', () => {
      setScrubbedHomeDir('D:\\Profiles\\alice')
      expect(scrubPII('cannot open D:\\Profiles\\alice.')).toBe(
        'cannot open D:\\Profiles\\[REDACTED].'
      )
    })

    it('redacts a POSIX home outside /home', () => {
      setScrubbedHomeDir('/var/lib/alice')
      expect(scrubPII('cat /var/lib/alice/.config')).toBe('cat /var/lib/[REDACTED]/.config')
    })

    it('redacts a single-segment home only at a path root', () => {
      setScrubbedHomeDir('/data')
      expect(scrubPII('cat /data/.config')).toBe('cat /[REDACTED]/.config')
      expect(scrubPII('ls /mnt/data/x')).toBe('ls /mnt/data/x')
    })

    it('ignores /root and a bare drive', () => {
      setScrubbedHomeDir('/root')
      expect(scrubPII('/root/.cache')).toBe('/root/.cache')
      setScrubbedHomeDir('C:\\')
      expect(scrubPII('C:\\ComfyUI')).toBe('C:\\ComfyUI')
    })
  })

  describe('scrubSecrets', () => {
    it('redacts common authorization, provider-token, and query forms', () => {
      const value =
        'Authorization: Basic abc123 github_pat_1234567890123456 https://x.test?a=1&token=secret123'
      const scrubbed = scrubSecrets(value)
      expect(scrubbed).not.toContain('abc123')
      expect(scrubbed).not.toContain('github_pat_')
      expect(scrubbed).not.toContain('secret123')
    })
    it('redacts OpenAI keys', () => {
      expect(scrubSecrets('Authorization: sk-abcdef0123456789abcdef0123')).toBe(
        'Authorization: [REDACTED]'
      )
    })

    it('redacts Hugging Face tokens', () => {
      expect(scrubSecrets('token=hf_abcdefghijklmnopqrstuvwx')).toBe('token=[REDACTED]')
    })

    it('redacts Bearer tokens', () => {
      expect(scrubSecrets('Authorization: Bearer abcdef0123456789abcdef0123456789')).toBe(
        'Authorization: Bearer [REDACTED]'
      )
    })

    it('redacts basic-auth credentials in URLs', () => {
      expect(scrubSecrets('git clone https://user:pass@github.com/foo/bar.git')).toBe(
        'git clone https://[REDACTED]@github.com/foo/bar.git'
      )
    })

    it('redacts KEY=, TOKEN=, SECRET=, PASSWORD= assignments', () => {
      expect(scrubSecrets('API_KEY=abc123 OTHER=ok')).toBe('API_KEY=[REDACTED] OTHER=ok')
      expect(scrubSecrets('GITHUB_TOKEN=ghp_xxxx')).toBe('GITHUB_TOKEN=[REDACTED]')
      expect(scrubSecrets('PASSWORD=hunter2')).toBe('PASSWORD=[REDACTED]')
    })
  })

  describe('quoted secret values', () => {
    it('redacts complete values containing spaces and punctuation', () => {
      expect(scrubSecrets('{"password":"correct horse, battery staple!"}')).toBe(
        '{"password":[REDACTED]}'
      )
      expect(scrubSecrets("{'auth_token': 'secret value, with punctuation!'}")).toBe(
        "{'auth_token': [REDACTED]}"
      )
    })
  })

  describe('scrubAll', () => {
    it('applies both PII and secret scrubbing in one pass', () => {
      const input = 'Error at /Users/alice/code: Bearer abcdef0123456789abcdef0123456789'
      const output = scrubAll(input)
      expect(output).toContain('/Users/[REDACTED]/code')
      expect(output).toContain('Bearer [REDACTED]')
      expect(output).not.toContain('alice')
      expect(output).not.toContain('abcdef0123456789')
    })

    it('returns the input unchanged when nothing matches', () => {
      expect(scrubAll('plain telemetry payload with no secrets')).toBe(
        'plain telemetry payload with no secrets'
      )
    })
  })

  describe('normalizeExceptionContext', () => {
    it('scrubs before truncating and removes nested values', () => {
      const normalized = normalizeExceptionContext(
        {
          secret: 'token="correct horse battery staple" trailing',
          nested: { password: 'still secret' },
          values: ['alice@example.com', { secret: 'nope' }, 2]
        },
        { maxStringLength: 20 }
      )
      expect(normalized.secret).toBe('token=[REDACTED] tra')
      expect(normalized).not.toHaveProperty('nested')
      expect(normalized.values).toEqual(['[REDACTED]', 2])
    })

    it('caps keys and array items', () => {
      const normalized = normalizeExceptionContext(
        { first: [1, 2, 3], second: 'dropped' },
        { maxKeys: 1, maxArrayItems: 2 }
      )
      expect(normalized).toEqual({ first: [1, 2] })
    })
  })
})
