import { cva, type VariantProps } from 'cva'

export const cardVariants = cva({
  base: 'relative border',
  variants: {
    variant: {
      /** Default raised card: top-edge shine + soft shadow. */
      elevated: 'edge-shine rounded-card bg-card-background shadow-elev',
      /** Frosted glass, same recipe as the sidebar. */
      glass:
        'rounded-panel border-border-default bg-media-overlay shadow-popover backdrop-blur-glass backdrop-saturate-[1.6]',
      /** Placeholder / create-new tiles. */
      dashed: 'rounded-card border-dashed border-border-strong bg-transparent',
      /** Quiet group inside another surface. */
      inset: 'rounded-control border-border-default bg-secondary-background/60'
    },
    padding: { none: '', xs: 'p-1', sm: 'p-3', md: 'p-4', lg: 'p-7' },
    interactive: {
      true: 'cursor-pointer outline-none transition-[background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-border-focus'
    }
  },
  compoundVariants: [
    {
      variant: 'elevated',
      interactive: true,
      class: 'hover:bg-card-background-hover hover:shadow-elev-hover hover:[--shine:0.22]'
    },
    {
      variant: 'dashed',
      interactive: true,
      class: 'text-muted-foreground hover:bg-secondary-background/50 hover:text-base-foreground'
    }
  ],
  defaultVariants: { variant: 'elevated', padding: 'none' }
})

export type CardVariants = VariantProps<typeof cardVariants>
