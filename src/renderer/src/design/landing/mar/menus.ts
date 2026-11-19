/** A folder path as a menu shows it (Mar's proposal): the home folder as
 *  "~", so the part that tells folders apart fits on the line. */
export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~')
}
