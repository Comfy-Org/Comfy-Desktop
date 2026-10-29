/** Shared geometry for the New Instance and installed-instance tiles. */
export const chooserTileClass =
  'group/tile relative [&.tile-leave-active]:absolute [&.tile-leave-to]:opacity-0 [&.tile-enter-from]:opacity-0 flex aspect-[246/156.678] flex-col items-start justify-end gap-1.5 rounded-xl border border-solid border-[var(--tile-border,var(--chooser-surface-border))] bg-[var(--chooser-surface-bg)] px-[18px] py-4 text-left [font:inherit] text-inherit cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] ease-[ease] hover:border-[var(--chooser-surface-border-hover)] hover:bg-[var(--chooser-surface-bg-hover)] focus-visible:border-[var(--chooser-surface-border-hover)] focus-visible:bg-[var(--chooser-surface-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] focus-visible:[outline-style:solid]'

export const chooserTileIconClass =
  'absolute top-3.5 left-4 text-neutral-100 opacity-[0.85] group-hover/tile:text-text group-hover/tile:opacity-100 group-focus-visible/tile:text-text group-focus-visible/tile:opacity-100'

export const chooserTileNameClass =
  'block min-w-0 max-w-full text-[16px] font-semibold text-neutral-100 group-hover/tile:text-text group-focus-visible/tile:text-text'

export const chooserTilePillClass =
  'inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-[999px] border border-solid px-2 py-0.5 text-[11px] text-ellipsis whitespace-nowrap'

export const chooserTileDangerClass =
  'inline-flex items-center gap-1 rounded-[999px] border border-solid border-[var(--accent-danger,#d92d20)] bg-[var(--accent-danger-soft,rgba(217,45,32,0.12))] px-2 py-[3px] text-[11px] font-medium text-[var(--accent-danger,#d92d20)] cursor-pointer transition-[background-color,transform] duration-[120ms] ease-[ease] hover:bg-[var(--accent-danger-soft-hover,rgba(217,45,32,0.22))] hover:[transform:scale(1.03)] hover:outline-none focus-visible:bg-[var(--accent-danger-soft-hover,rgba(217,45,32,0.22))] focus-visible:[transform:scale(1.03)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-danger,#d92d20)] focus-visible:[outline-style:solid]'
