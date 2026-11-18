import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Mesh, MeshStandardMaterial, Points, Texture } from 'three'

import { disposeModel, parseModel, tintUntexturedWhite } from './modelFile'

const POINT_CLOUD_PLY = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
end_header
0 0 0
1 0 0
0 1 0
`

const TRIANGLE_PLY = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('parseModel', () => {
  it('draws a PLY file without faces, like a Gaussian splat, as points', async () => {
    expect(await parseModel(bytes(POINT_CLOUD_PLY), 'splat.ply')).toBeInstanceOf(Points)
  })

  it('draws a PLY file with faces as a surface', async () => {
    expect(await parseModel(bytes(TRIANGLE_PLY), 'mesh.ply')).toBeInstanceOf(Mesh)
  })

  it('does not read a text glTF file, which loads its parts from other files', async () => {
    expect(await parseModel(bytes('{"asset":{"version":"2.0"}}'), 'scene.gltf')).toBeNull()
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

describe('disposeModel', () => {
  it('frees the geometry, the material, its textures and their decoded pictures', async () => {
    const picture = await createImageBitmap(new ImageData(1, 1))
    const texture = new Texture(picture)
    const material = new MeshStandardMaterial({ map: texture })
    const geometry = new BoxGeometry()
    const close = vi.spyOn(picture, 'close')
    const freed = [
      vi.spyOn(texture, 'dispose'),
      vi.spyOn(material, 'dispose'),
      vi.spyOn(geometry, 'dispose')
    ]

    disposeModel(new Mesh(geometry, material))

    expect(close).toHaveBeenCalledOnce()
    for (const dispose of freed) expect(dispose).toHaveBeenCalledOnce()
  })
})
