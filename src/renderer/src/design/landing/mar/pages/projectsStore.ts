import { PROJECTS, TEMPLATES, thumb, type Template } from '../../mock'
import { collection } from './collection'
import { PROJECT_ART } from '../assets/mock'

/**
 * Projects in Mar's proposal: a shared place that always runs on one
 * build (Pablo's model), with a photo, who's in it and how busy it is.
 * In memory, so the libraries' Move to project lists what's here now.
 */
export interface MarProject {
  id: string
  name: string
  envId: string
  art: string
  members: string[]
  updated: string
  archived?: boolean
  shared?: boolean
  fav?: boolean
  status?: 'running' | 'failed'
}

const ART = PROJECT_ART
const PEOPLE = [
  ['Pablo'],
  ['Pablo', 'Mia'],
  ['Pablo', 'Sam', 'Ana'],
  ['Pablo', 'Mia', 'Sam', 'Ana', 'Leo'],
  ['Pablo']
]
const UPDATED = ['12 min ago', '1 hour ago', 'Yesterday', '2 days ago', 'Last week']

export const projects = collection<MarProject>(
  PROJECTS.map((p, i) => ({
    ...p,
    art: ART[i % ART.length]!,
    members: PEOPLE[i % PEOPLE.length]!,
    updated: UPDATED[i % UPDATED.length]!,
    shared: PEOPLE[i % PEOPLE.length]!.length > 1,
    status: i === 0 ? ('running' as const) : undefined
  })),
  'project'
)

export const projectNames = (): string[] =>
  projects.items.filter((p) => !p.archived).map((p) => p.name)

export function projectByName(name?: string): MarProject | undefined {
  return projects.items.find((p) => p.name === name)
}

let made = 0
export function newProject(envId = 'local-1'): MarProject {
  const p: MarProject = {
    id: `new-${++made}`,
    name: made === 1 ? 'Untitled project' : `Untitled project ${made}`,
    envId,
    art: ART[(projects.items.length + made) % ART.length]!,
    members: ['Pablo'],
    updated: 'Just now'
  }
  projects.items.unshift(p)
  return p
}

/** A cover from the templates, for things with no picture of their own. */
export const coverFor = (i: number): string =>
  thumb((TEMPLATES[i % TEMPLATES.length] as Template).id)
