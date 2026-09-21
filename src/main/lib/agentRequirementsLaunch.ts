import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { installFilteredRequirementsDetailed } from './pip'
import { withOutputTail } from './logged-process'
import { getActivePythonPath, getActiveUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'

/** The Core flag that starts ComfyUI with the agent enabled. */
const ENABLE_AGENT_ARG = '--enable-agent'

/** Requirements file Core ships beside `main.py` for the agent. */
const AGENT_REQUIREMENTS = 'agent_requirements.txt'

/**
 * Ceiling on how long a launch waits for the install.
 *
 * The launch blocks on this so the agent is usable on the run that enables it,
 * but core starts perfectly well without the packages, so holding a user at the
 * launcher indefinitely to acquire them inverts that. Past the ceiling uv is
 * killed and the launch goes ahead with the flag still set: core prints its own
 * install hint and disables the agent. The matching bound one step earlier is
 * the args-schema probe's 15s, which fails open the same way.
 *
 * The ceiling is generous rather than tight because uv streams nothing while a
 * wheel downloads, so a slow transfer is indistinguishable from a stall. A link
 * too slow to finish inside it never gets the agent from this path.
 */
const INSTALL_TIMEOUT_MS = 120_000

export interface AgentRequirementsInstall {
  reqPath: string
  uvPath: string
  pythonPath: string
  installPath: string
}

/**
 * Decide whether this launch installs the agent's Python requirements, and
 * resolve everything the install needs.
 *
 * `args` must be the FINAL spawn args. `--enable-agent` reaches them either
 * from the user's own launch args or from a Core beta grant, so the args are
 * the one place that knows whether the agent is really starting. A core whose
 * schema does not know the flag has normally had it filtered out by then, with
 * one exception: when schema discovery itself failed the launch keeps the raw
 * args, so a hand-typed flag survives to a core that cannot parse it. That
 * launch fails on argparse either way; the cost is one wasted install.
 *
 * The environment test is the one every `manager_requirements.txt` site makes,
 * which is what confines this to the Desktop-managed installs (standalone and
 * adopted). Portable, git and build installs drive a Python environment this
 * helper has no uv binary for; Core's own `pip install -r` hint covers them.
 */
export function planAgentRequirementsInstall(
  installation: InstallationRecord,
  args: readonly string[]
): AgentRequirementsInstall | null {
  if (!args.includes(ENABLE_AGENT_ARG)) return null
  const reqPath = path.join(installation.installPath, 'ComfyUI', AGENT_REQUIREMENTS)
  if (!fs.existsSync(reqPath)) return null
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) return null
  return { reqPath, uvPath, pythonPath, installPath: installation.installPath }
}

/**
 * Install the planned requirements, streaming uv's output into the launch.
 *
 * Bounded and fail-open. Never throws and reports nothing back: neither a
 * failure nor a timeout here may stop the launch. ComfyUI still starts with the
 * flag, prints its own install hint and disables the agent itself, which beats
 * refusing to start.
 *
 * `signal` is the launch's own, and stays untouched: uv is driven through a
 * controller owned here, so the deadline ends the wait without cancelling the
 * launch. Aborting it kills uv's process tree and resolves once it is reaped,
 * so nothing is left writing to the environment ComfyUI is about to boot from.
 */
export async function installAgentRequirements(
  plan: AgentRequirementsInstall,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  sendOutput('\nInstalling agent requirements…\n')
  const uvAbort = new AbortController()
  const onLaunchAbort = (): void => uvAbort.abort()
  if (signal?.aborted) uvAbort.abort()
  else signal?.addEventListener('abort', onLaunchAbort, { once: true })
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    uvAbort.abort()
  }, INSTALL_TIMEOUT_MS)

  try {
    const result = await installFilteredRequirementsDetailed(
      plan.reqPath,
      plan.uvPath,
      plan.pythonPath,
      plan.installPath,
      '.launch-agent-reqs.txt',
      sendOutput,
      uvAbort.signal,
      settings.getMirrorConfig()
    )
    if (timedOut && !signal?.aborted) {
      sendOutput(
        `\n⚠ agent requirements install exceeded ${INSTALL_TIMEOUT_MS / 1000}s; starting ComfyUI without it\n`
      )
    } else if (result.code !== 0 && !signal?.aborted) {
      // A cancelled launch kills uv mid-install; that non-zero exit is the
      // cancellation, not a failure worth showing.
      sendOutput(
        `\n${withOutputTail(`⚠ agent requirements install exited with code ${result.code}`, result.output)}\n`
      )
    }
  } catch (err) {
    if (!signal?.aborted) {
      sendOutput(`⚠ ${AGENT_REQUIREMENTS} failed: ${(err as Error).message}\n`)
    }
  } finally {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', onLaunchAbort)
  }
}
