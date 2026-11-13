import { imageSize } from 'image-size'
import { imageSizeFromFile } from 'image-size/fromFile'
import type { IAudioMetadata, IOptions } from 'music-metadata'
import type { AssetKind } from '../../types/ipc'

export interface MediaFacts {
  width: number | null
  height: number | null
  durationSeconds: number | null
}

interface PictureSize {
  width?: number
  height?: number
  orientation?: number
}

const NO_FACTS: MediaFacts = { width: null, height: null, durationSeconds: null }
const FIRST_SIDEWAYS_EXIF_ORIENTATION = 5
const HEADERS_ONLY: IOptions = { duration: false, skipCovers: true, mkvUseIndex: true }

function pictureFacts(size: PictureSize | null): MediaFacts {
  if (!size?.width || !size.height) return NO_FACTS
  const sideways = (size.orientation ?? 0) >= FIRST_SIDEWAYS_EXIF_ORIENTATION
  return {
    width: sideways ? size.height : size.width,
    height: sideways ? size.width : size.height,
    durationSeconds: null
  }
}

function videoFacts(parsed: IAudioMetadata | null): MediaFacts {
  if (!parsed) return NO_FACTS
  const video = parsed.format.trackInfo.find(
    (track) => track.video?.pixelWidth && track.video.pixelHeight
  )?.video
  const duration = parsed.format.duration
  return {
    width: video?.pixelWidth ?? null,
    height: video?.pixelHeight ?? null,
    durationSeconds: duration && Number.isFinite(duration) ? duration : null
  }
}

function pictureSizeOf(bytes: Uint8Array): PictureSize | null {
  try {
    return imageSize(bytes)
  } catch {
    return null
  }
}

export async function mediaFactsFromFile(
  file: string,
  kind: AssetKind | null
): Promise<MediaFacts> {
  if (kind === 'image') return pictureFacts(await imageSizeFromFile(file).catch(() => null))
  if (kind !== 'video') return NO_FACTS
  const { parseFile } = await import('music-metadata')
  return videoFacts(await parseFile(file, HEADERS_ONLY).catch(() => null))
}

export async function mediaFactsFromBytes(
  bytes: Uint8Array,
  kind: AssetKind | null,
  mimeType: string | null
): Promise<MediaFacts> {
  if (kind === 'image') return pictureFacts(pictureSizeOf(bytes))
  if (kind !== 'video') return NO_FACTS
  const { parseBuffer } = await import('music-metadata')
  return videoFacts(await parseBuffer(bytes, mimeType ?? undefined, HEADERS_ONLY).catch(() => null))
}
