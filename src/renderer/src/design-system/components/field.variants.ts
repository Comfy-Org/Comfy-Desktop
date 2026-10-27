/** Shared shell for every text-entry control (SearchInput, Input) and the
 *  Select trigger, so they line up and share hover/focus states. Focus is
 *  drawn on the shell (focus-within), never on the native input. */
export const fieldClass = [
  'flex h-8 items-center gap-2 rounded-control border border-border-default bg-secondary-background px-2.5 text-ui text-base-foreground',
  'transition-[border-color,background-color,box-shadow] duration-150',
  'hover:border-border-strong',
  'focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/30',
  'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-40'
]

/** Native input inside a field shell: no chrome of its own. */
export const fieldInputClass =
  'min-w-0 flex-1 bg-transparent text-ui text-base-foreground outline-none placeholder:text-subtle-foreground'
