import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_WALK_DEPTH, pageOf, parseListRequest, walkFiles } from './listing'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-contents-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('parseListRequest', () => {
  it('accepts a well-formed request and an absent one', () => {
    expect(parseListRequest(undefined)).toEqual({})
    expect(
      parseListRequest({ query: 'flux', sort: 'name', cursor: '100', limit: 50, filter: 'loras' })
    ).toEqual({
      query: 'flux',
      sort: 'name',
      cursor: '100',
      limit: 50,
      filter: 'loras'
    })
  })

  it('refuses malformed input instead of guessing', () => {
    expect(parseListRequest('flux')).toBeNull()
    expect(parseListRequest({ sort: 'size' })).toBeNull()
    expect(parseListRequest({ limit: -1 })).toBeNull()
    expect(parseListRequest({ query: 3 })).toBeNull()
    expect(parseListRequest({ filter: ['loras'] })).toBeNull()
  })
})

describe('pageOf', () => {
  const items = ['Bravo', 'alpha', 'Charlie', 'delta'].map((name) => ({ name }))
  const how = {
    text: (i: { name: string }) => i.name,
    compare: (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
    truncated: false
  }

  it('filters, sorts and then pages, so later pages stay in order', () => {
    const first = pageOf(items, { limit: 2 }, how)
    expect(first).toMatchObject({ ok: true, total: 4, nextCursor: '2' })
    if (!first.ok) throw new Error('expected a page')
    expect(first.items.map((i) => i.name)).toEqual(['alpha', 'Bravo'])
    const second = pageOf(items, { limit: 2, cursor: first.nextCursor! }, how)
    if (!second.ok) throw new Error('expected a page')
    expect(second.items.map((i) => i.name)).toEqual(['Charlie', 'delta'])
    expect(second.nextCursor).toBeNull()
  })

  it('matches the query case-insensitively before counting', () => {
    expect(pageOf(items, { query: 'A' }, how)).toMatchObject({ total: 4 })
    expect(pageOf(items, { query: 'char' }, how)).toMatchObject({ total: 1 })
  })
})

describe('walkFiles', () => {
  it('lists accepted files below the root and reports when it hits the cap', async () => {
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(root, 'one.json'), '{}')
    fs.writeFileSync(path.join(root, 'a', 'two.json'), '{}')
    fs.writeFileSync(path.join(root, 'a', 'b', 'three.json'), '{}')
    fs.writeFileSync(path.join(root, 'a', 'notes.txt'), '')
    fs.writeFileSync(path.join(root, '.hidden.json'), '{}')

    const all = await walkFiles(root, (name) => name.endsWith('.json'))
    expect(all.truncated).toBe(false)
    expect(all.files.map((f) => f.relativePath).sort()).toEqual([
      'a/b/three.json',
      'a/two.json',
      'one.json'
    ])

    const capped = await walkFiles(root, (name) => name.endsWith('.json'), 2)
    expect(capped.files.length).toBeLessThan(3)
    expect(capped.truncated).toBe(true)
  })

  it('counts the entries it reads, kept or not, against the cap', async () => {
    const noise = path.join(root, 'noise')
    fs.mkdirSync(noise)
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(noise, `${i}.txt`), '')
    const walked = await walkFiles(noise, (name) => name.endsWith('.json'), 3)
    expect(walked).toEqual({ files: [], truncated: true })
  })

  it('reports truncated when a folder is too deep to read', async () => {
    const deep = path.join(
      root,
      'deep',
      ...Array.from({ length: MAX_WALK_DEPTH + 1 }, (_, i) => `d${i}`)
    )
    fs.mkdirSync(deep, { recursive: true })
    fs.writeFileSync(path.join(deep, 'far.json'), '{}')
    const walked = await walkFiles(path.join(root, 'deep'), (name) => name.endsWith('.json'))
    expect(walked).toEqual({ files: [], truncated: true })
  })

  it('follows linked folders, walking each folder once', async () => {
    const linkRoot = path.join(root, 'links')
    const target = path.join(root, 'elsewhere')
    fs.mkdirSync(linkRoot)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'shared.json'), '{}')
    // Junctions need no extra rights on Windows; elsewhere they are symlinks.
    fs.symlinkSync(target, path.join(linkRoot, 'shared'), 'junction')
    fs.symlinkSync(linkRoot, path.join(target, 'back'), 'junction')

    const { files } = await walkFiles(linkRoot, (name) => name.endsWith('.json'))
    expect(files.map((f) => f.relativePath)).toEqual(['shared/shared.json'])
  })

  it('reads a missing folder as empty', async () => {
    expect(await walkFiles(path.join(root, 'nope'), () => true)).toEqual({
      files: [],
      truncated: false
    })
  })
})
