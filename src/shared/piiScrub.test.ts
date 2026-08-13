import { describe, expect, it } from 'vitest'
import { normalizeExceptionContext, scrubAll, scrubPII, scrubSecrets } from './piiScrub'

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

    it('leaves paths without user segments untouched', () => {
      expect(scrubPII('/opt/comfy/bin/comfyui')).toBe('/opt/comfy/bin/comfyui')
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
