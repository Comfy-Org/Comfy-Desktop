import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** Same helper as ComfyUI_frontend's `@comfyorg/tailwind-utils`, taught the
 *  design system's custom scales so `text-ui` and `text-muted-foreground`
 *  don't get merged as two colors. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['ui', 'heading', 'title', 'display'],
      radius: ['panel', 'card', 'control', 'min'],
      shadow: ['elev', 'elev-hover', 'popover', 'highlight']
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
