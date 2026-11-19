import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  Points,
  Scene,
  Texture
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

import { isSelfContainedGlb, startModelLoad, tintUntexturedWhite } from './modelFile'

const PLY_HEADER = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
`

const POINT_CLOUD_PLY = `${PLY_HEADER}end_header
0 0 0
1 0 0
0 1 0
`

const TRIANGLE_PLY = `${PLY_HEADER}element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`

const COLOURED_FACE_PLY = `${PLY_HEADER}element face 1
property list uchar int vertex_indices
property uchar red
property uchar green
property uchar blue
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2 255 0 0
`

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function glb(json: object): Uint8Array {
  const body = text(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(body.byteLength / 4) * 4).fill(0x20)
  padded.set(body)
  const file = new Uint8Array(20 + padded.byteLength)
  const view = new DataView(file.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, file.byteLength, true)
  view.setUint32(12, padded.byteLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  file.set(padded, 20)
  return file
}

async function texturedGlb(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 4
  const material = new MeshStandardMaterial({ map: new CanvasTexture(canvas) })
  const exported = await new GLTFExporter().parseAsync(
    new Scene().add(new Mesh(new BoxGeometry(), material)),
    { binary: true }
  )
  return new Uint8Array(exported as ArrayBuffer)
}

const SIGNED_PICTURE = 'https://storage.googleapis.com/b/t.png?X-Goog-Signature=secret'

afterEach(() => vi.restoreAllMocks())

describe('isSelfContainedGlb', () => {
  it('accepts a GLB whose data and pictures are inside the file', () => {
    expect(
      isSelfContainedGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] }))
    ).toBe(true)
  })

  it.each([
    ['a picture link', { asset: { version: '2.0' }, images: [{ uri: SIGNED_PICTURE }] }],
    ['a data link', { asset: { version: '2.0' }, buffers: [{ uri: 'data:,abc', byteLength: 3 }] }]
  ])('turns away a GLB with %s', (_case, json) => {
    expect(isSelfContainedGlb(glb(json))).toBe(false)
  })

  it('turns away text JSON with a .glb name', () => {
    expect(isSelfContainedGlb(text(JSON.stringify({ asset: { version: '2.0' } })))).toBe(false)
  })
})

describe('startModelLoad', () => {
  it('opens no link a GLB points to, and logs none', async () => {
    const logged = vi.spyOn(console, 'error')

    const model = await startModelLoad().parse(
      glb({ asset: { version: '2.0' }, images: [{ uri: SIGNED_PICTURE }] }),
      'fox.glb'
    )

    expect(model).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it('does not read a text glTF file, which loads its parts from other files', async () => {
    expect(
      await startModelLoad().parse(text('{"asset":{"version":"2.0"}}'), 'scene.gltf')
    ).toBeNull()
  })

  it.each([
    ['without faces, like a Gaussian splat, as points', POINT_CLOUD_PLY, Points],
    ['with faces as a surface', TRIANGLE_PLY, Mesh],
    ['with coloured faces as a surface', COLOURED_FACE_PLY, Mesh]
  ])('draws a PLY file %s', async (_case, file, shape) => {
    expect(await startModelLoad().parse(text(file), 'model.ply')).toBeInstanceOf(shape)
  })

  it('closes the pictures a textured GLB decoded when it is released', async () => {
    const close = vi.spyOn(ImageBitmap.prototype, 'close')
    const load = startModelLoad()
    const model = await load.parse(await texturedGlb(), 'box.glb')
    expect(model).not.toBeNull()
    expect(close).not.toHaveBeenCalled()

    load.release()

    expect(close).toHaveBeenCalled()
  })

  it('frees a GLB that finishes loading after it was released', async () => {
    const close = vi.spyOn(ImageBitmap.prototype, 'close')
    const disposed = vi.spyOn(Texture.prototype, 'dispose')
    const load = startModelLoad()
    const parsing = load.parse(await texturedGlb(), 'box.glb')

    load.release()
    await parsing

    expect(close).toHaveBeenCalled()
    expect(disposed).toHaveBeenCalled()
  })
})

describe('tintUntexturedWhite', () => {
  it('turns a plain white model warm grey and keeps a coloured one', () => {
    const white = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0xffffff }))
    const orange = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0xff8800 }))
    white.add(orange)

    tintUntexturedWhite(white)

    expect((white.material as MeshStandardMaterial).color.getHex()).not.toBe(0xffffff)
    expect((orange.material as MeshStandardMaterial).color.getHex()).toBe(0xff8800)
  })
})
