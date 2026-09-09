export const ALLOWED_EXTENSIONS = ['.safetensors', '.sft', '.ckpt', '.pth', '.pt']

export function stripQueryParams(rawFilename: string): string {
  const qIdx = rawFilename.indexOf('?')
  return qIdx >= 0 ? rawFilename.substring(0, qIdx) : rawFilename
}
