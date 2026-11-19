const SEPARATOR = ' · '

export function progressTitle(action: string, buildName: string): string {
  return `${action}${SEPARATOR}${buildName}`
}

export function progressActionName(title: string): string {
  return title.split(SEPARATOR)[0] || title
}
