import { cva } from 'cva'
import type { VariantProps } from 'cva'

export const badgeVariants = cva({
  base: 'inline-flex shrink-0 items-center gap-1 font-medium whitespace-nowrap',
  variants: {
    variant: {
      default: 'bg-secondary-background text-muted-foreground',
      outline: 'text-base-foreground ring-1 ring-border-strong ring-inset',
      /** On imagery: blurred dark chip. */
      overlay: 'bg-media-overlay text-base-foreground backdrop-blur-sm',
      danger: 'bg-status-danger/15 text-status-danger'
    },
    size: {
      sm: 'h-5 rounded-full px-2 text-ui',
      md: 'h-6 rounded-min px-2 text-ui'
    }
  },
  defaultVariants: { variant: 'default', size: 'sm' }
})

export type BadgeVariants = VariantProps<typeof badgeVariants>
