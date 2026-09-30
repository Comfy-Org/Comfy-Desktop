/**
 * Free space required per byte of template models: the coarse size estimate plus
 * room for staging files and the estimate's imprecision. Shared so the picker's
 * disk alert and the download task's pre-flight guard make the same decision.
 */
export const TEMPLATE_DISK_HEADROOM = 1.1
