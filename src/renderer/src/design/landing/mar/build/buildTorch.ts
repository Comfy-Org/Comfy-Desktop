import { proto } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { factsOf, selectedTorch } from './buildFacts'
import { runOp } from './buildOps'
import { setExtra } from './m1Builds'

/** The official PyTorch builds tested with a build: the installed one first. */
export function torchOptions(
  env: ProtoInstance
): { v: string; note: string; short: string; on: boolean }[] {
  const facts = factsOf(env)
  const installed = facts.torch.split(' ')[0]!
  const current = selectedTorch[env.id] ?? installed
  return [
    { v: installed, note: facts.torch, short: 'Installed' },
    { v: '2.10.0', note: '2.4 GB download', short: '2.4 GB download' },
    {
      v: '2.11.0.dev',
      note: '2.6 GB download  ·  Nightly build: unstable, and installable for only about 60 days after publication',
      short: 'Nightly, unstable  ·  2.6 GB download'
    }
  ].map((t) => ({ ...t, on: t.v === current }))
}

/** A copy of the build, next to it in the list, with the new PyTorch. */
function copyWithTorch(env: ProtoInstance, v: string): void {
  const n = proto.addedInstances.filter((i) => i.id.startsWith(`${env.id}-copy`)).length + 1
  const id = `${env.id}-copy-${n}`
  proto.addedInstances.unshift({
    ...env,
    id,
    name: n === 1 ? `${env.name} copy` : `${env.name} copy ${n}`,
    state: 'stopped',
    lastUsed: 'Just now',
    lastUsedRank: -1
  })
  selectedTorch[id] = v
  setExtra(id, { from: { how: 'Copied', name: env.name } })
}

/** Change PyTorch moves the selection once it finishes; Copy & Change leaves the build as it is. */
export function changeTorch(env: ProtoInstance, v: string, copy: boolean): void {
  runOp(env.id, {
    title: copy ? `Copying & changing PyTorch to ${v}…` : `Changing PyTorch to ${v}…`,
    done: copy ? 'Copy complete' : 'PyTorch changed',
    then: copy ? () => copyWithTorch(env, v) : () => (selectedTorch[env.id] = v)
  })
}
