import type { Component } from 'vue'
import {
  Aperture,
  AudioLines,
  AudioWaveform,
  Braces,
  Clapperboard,
  Columns2,
  Download,
  Film,
  Image,
  LayoutGrid,
  MessageSquareText,
  Pause,
  Scissors,
  Type,
  ZoomIn
} from 'lucide-vue-next'
import { ComfyWorkflow } from '../icons/comfyIcons'
import type { NodeKind } from './canvasData'

/** Each node kind's icon, beside its title and in the add-node menu. */
export const NODE_ICONS: Record<NodeKind, Component> = {
  prompt: Type,
  image: Image,
  video: Film,
  audio: AudioLines,
  generate: Aperture,
  generateVideo: Clapperboard,
  generateAudio: AudioWaveform,
  llm: MessageSquareText,
  promptConstructor: Braces,
  removeBg: Scissors,
  upscale: ZoomIn,
  workflow: ComfyWorkflow,
  pause: Pause,
  compare: Columns2,
  gallery: LayoutGrid,
  output: Download
}
