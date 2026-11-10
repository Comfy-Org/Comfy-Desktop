export function loadProprietaryFonts(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return

  const face = new FontFace(
    'PP Formula',
    "url('./fonts/PPFormula-Extrabold.otf') format('opentype')",
    { weight: '800', style: 'normal', display: 'swap' }
  )

  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded)
    })
    .catch(() => {})
}
