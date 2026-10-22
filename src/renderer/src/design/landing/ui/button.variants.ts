import { cva, type VariantProps } from 'cva'

export const buttonVariants = cva({
  base: [
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none',
    'transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]',
    'outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
    'disabled:pointer-events-none disabled:opacity-40'
  ],
  variants: {
    variant: {
      /** The one white CTA per surface. */
      primary: 'bg-inverted-background text-inverted-foreground hover:bg-inverted-background-hover',
      secondary:
        'border border-border-strong bg-card-background-hover text-base-foreground shadow-highlight hover:bg-card-background',
      ghost: 'text-muted-foreground hover:bg-secondary-background hover:text-base-foreground',
      subtle: 'bg-secondary-background text-base-foreground hover:bg-secondary-background-hover',
      /** Chips that sit on imagery. */
      overlay: 'bg-media-overlay text-base-foreground backdrop-blur-sm hover:bg-black/75',
      link: 'h-auto px-0 text-muted-foreground hover:text-base-foreground',
      /** Irreversible actions only (delete). Muted, never bright. */
      destructive: 'bg-status-danger text-base-foreground hover:bg-status-danger/85'
    },
    size: {
      sm: 'h-7 rounded-control px-2.5 text-ui',
      md: 'h-8 rounded-control px-3 text-ui',
      lg: 'h-9 rounded-control px-4 text-ui',
      'icon-sm': 'size-7 rounded-control',
      icon: 'size-8 rounded-control',
      'icon-xs': 'size-6 rounded-min'
    },
    block: { true: 'w-full' }
  },
  compoundVariants: [{ variant: 'link', class: 'h-auto px-0' }],
  defaultVariants: { variant: 'secondary', size: 'md' }
})

export type ButtonVariants = VariantProps<typeof buttonVariants>
