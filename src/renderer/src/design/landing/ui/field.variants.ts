import { cva, type VariantProps } from 'cva'

/** Shared shell for every text-entry control (SearchInput, Input) and the
 *  Select trigger, so they line up and share hover/focus states. Focus is
 *  drawn on the shell (focus-within), never on the native input. */
export const fieldVariants = cva({
  base: [
    'flex items-center gap-2 rounded-control border border-border-default bg-secondary-background text-ui text-base-foreground',
    'transition-[border-color,background-color,box-shadow] duration-150',
    'hover:border-border-strong',
    'focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/30',
    'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-40'
  ],
  variants: {
    size: { sm: 'h-7 px-2', md: 'h-8 px-2.5', lg: 'h-9 px-3' }
  },
  defaultVariants: { size: 'md' }
})

export type FieldVariants = VariantProps<typeof fieldVariants>

/** Native input inside a field shell: no chrome of its own. */
export const fieldInputClass =
  'min-w-0 flex-1 bg-transparent text-ui text-base-foreground outline-none placeholder:text-subtle-foreground'
