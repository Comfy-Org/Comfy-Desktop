export function templateModelAccessUrl(templateId: string): string | null {
  return templateId === 'image_flux3_klein_distilled_t2i'
    ? 'https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy'
    : null
}
