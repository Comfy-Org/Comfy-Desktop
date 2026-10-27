/** Shared by DropdownMenu and Select content so every floating
 *  surface looks the same. Menu radius 12, padding 4 -> items radius 8. */
export const floatingSurface =
  'ds-root z-50 rounded-card border border-border-default bg-card-background p-1 text-base-foreground shadow-popover outline-none data-[state=open]:animate-pop-in'

export const menuItem =
  'relative flex min-h-8 cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-1.5 text-ui text-base-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-secondary-background [&>svg]:shrink-0 [&>svg]:text-muted-foreground'
