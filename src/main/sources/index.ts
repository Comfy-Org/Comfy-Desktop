import { standalone } from './standalone'
import { portable } from './portable'
import { gitSource } from './git'
import { remote } from './remote'
import { cloud } from './cloud'
import { desktop } from './desktop'
import { comfybuilder } from './comfybuilder'
import type { SourcePlugin } from '../types/sources'

const sources: SourcePlugin[] = [standalone, comfybuilder, portable, gitSource, cloud, remote, desktop]

export default sources
