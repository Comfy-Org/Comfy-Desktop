import { describe, expect, it } from 'vitest'
import {
  buildErrorFields,
  extractErrorClass,
  normalizeSignature,
  errorTail,
  ERROR_MESSAGE_MAX
} from './errorEvent'

describe('errorEvent', () => {
  describe('extractErrorClass', () => {
    it('extracts the Python exception class from a single message', () => {
      expect(extractErrorClass("ModuleNotFoundError: No module named 'torch'")).toBe(
        'ModuleNotFoundError'
      )
    })

    it('takes the FINAL exception line from a multi-line traceback', () => {
      const traceback = [
        'Traceback (most recent call last):',
        '  File "main.py", line 10, in <module>',
        '    import torch',
        'ImportError: partially initialized module',
        '',
        'During handling of the above exception, another exception occurred:',
        '',
        'RuntimeError: CUDA driver initialization failed'
      ].join('\n')
      expect(extractErrorClass(traceback)).toBe('RuntimeError')
    })

    it('maps fixed English CUDA/OOM signatures to a stable class', () => {
      expect(extractErrorClass('CUDA error: no kernel image is available for execution')).toBe(
        'CUDANoKernelImage'
      )
      expect(extractErrorClass('torch.cuda.OutOfMemoryError: CUDA out of memory. Tried...')).toBe(
        // The Python class token wins over the phrase dictionary.
        'torch.cuda.OutOfMemoryError'
      )
      expect(extractErrorClass('RuntimeError: CUDA out of memory')).toBe('RuntimeError')
      expect(extractErrorClass('some fatal cuda out of memory condition')).toBe('CUDAOutOfMemory')
    })

    it('uses a meaningful JS Error name over the generic Error', () => {
      expect(extractErrorClass(new TypeError('bad'))).toBe('TypeError')
      expect(extractErrorClass(new Error('plain'))).toBe('unknown')
    })

    it('is locale-independent: a localized message still yields the class', () => {
      // Localized OSError text (message differs by locale, class does not).
      expect(extractErrorClass('OSError: 找不到指定的模块。')).toBe('OSError')
    })

    it('falls back to unknown when there is no class signal', () => {
      expect(extractErrorClass('something went wrong')).toBe('unknown')
      expect(extractErrorClass('')).toBe('unknown')
    })
  })

  describe('normalizeSignature', () => {
    it('redacts numbers, hex, uuids, quoted strings and paths', () => {
      const sig = normalizeSignature(
        "failed on C:\\Users\\bob\\model.ckpt at 0xDEADBEEF id 12345 name 'foo'"
      )
      expect(sig).not.toContain('12345')
      expect(sig).not.toContain('0xdeadbeef')
      expect(sig).not.toContain('bob')
      expect(sig).not.toContain("'foo'")
      expect(sig).toContain('<path>')
      expect(sig).toContain('<str>')
      expect(sig).toContain('#')
    })

    it('groups the same error shape with different values to one signature', () => {
      const a = normalizeSignature('Process exited with code 3221225477')
      const b = normalizeSignature('Process exited with code 1')
      expect(a).toBe(b)
    })
  })

  describe('buildErrorFields', () => {
    it('returns all four standard fields', () => {
      const fields = buildErrorFields("ModuleNotFoundError: No module named 'torch'")
      expect(fields).toMatchObject({
        error_class: 'ModuleNotFoundError',
        error_bucket: 'import_error'
      })
      expect(fields.error_message).toContain('No module named')
      expect(fields.error_signature.startsWith('ModuleNotFoundError|')).toBe(true)
    })

    it('uses the final exception line as the message, not preceding noise', () => {
      const traceback = [
        'Loading node pack A...',
        'Loading node pack B...',
        'Traceback (most recent call last):',
        '  File "x.py", line 1',
        'RuntimeError: the real failure'
      ].join('\n')
      const fields = buildErrorFields(traceback)
      expect(fields.error_class).toBe('RuntimeError')
      expect(fields.error_message).toBe('RuntimeError: the real failure')
    })

    it('scrubs PII from the message', () => {
      const fields = buildErrorFields(
        "FileNotFoundError: No such file 'C:\\Users\\alice\\wf.json'"
      )
      expect(fields.error_message).not.toContain('alice')
      expect(fields.error_message).toContain('[REDACTED]')
    })

    it('caps the message length', () => {
      const long = 'x'.repeat(ERROR_MESSAGE_MAX + 500)
      const fields = buildErrorFields(long)
      expect(fields.error_message.length).toBe(ERROR_MESSAGE_MAX)
    })

    it('honors a pinned error class and reflects it in the signature', () => {
      const fields = buildErrorFields('Failed to validate prompt for output 9:', {
        errorClass: 'validation_failed'
      })
      expect(fields.error_class).toBe('validation_failed')
      expect(fields.error_signature.startsWith('validation_failed|')).toBe(true)
    })

    it('handles Error instances and nullish input', () => {
      expect(buildErrorFields(new RangeError('nope')).error_class).toBe('RangeError')
      expect(buildErrorFields(null).error_class).toBe('unknown')
      expect(buildErrorFields(undefined).error_message).toBe('')
    })
  })

  describe('errorTail', () => {
    it('returns the LAST N lines, scrubbed', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
      const tail = errorTail(lines.join('\n'), { lines: 5 })
      expect(tail).toBe(['line 95', 'line 96', 'line 97', 'line 98', 'line 99'].join('\n'))
    })

    it('scrubs user paths in the tail', () => {
      const tail = errorTail('boom at C:\\Users\\carol\\thing.py')
      expect(tail).not.toContain('carol')
      expect(tail).toContain('[REDACTED]')
    })

    it('bounds the tail to maxChars', () => {
      const tail = errorTail('a'.repeat(9000), { lines: 40, maxChars: 100 })
      expect(tail!.length).toBe(100)
    })

    it('returns null for empty / whitespace input', () => {
      expect(errorTail('')).toBeNull()
      expect(errorTail(null)).toBeNull()
      expect(errorTail('   \n  ')).toBeNull()
    })
  })
})
