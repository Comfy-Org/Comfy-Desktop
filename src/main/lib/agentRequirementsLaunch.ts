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
 * from the user's own launch args or from a Core beta grant, and a core whose
 * schema does not know the flag has already had it filtered out, so the args
 * are the one place that knows whether the agent is really starting.
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
 * Never throws and reports nothing back: a failure here must not stop the
 * launch. ComfyUI still starts with the flag, prints its own install hint and
 * disables the agent itself, which beats refusing to start.
 */
export async function installAgentRequirements(
  plan: AgentRequirementsInstall,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  sendOutput('\nInstalling agent requirements…\n')
  try {
    const result = await installFilteredRequirementsDetailed(
      plan.reqPath,
      plan.uvPath,
      plan.pythonPath,
      plan.installPath,
      '.launch-agent-reqs.txt',
      sendOutput,
      signal,
      settings.getMirrorConfig()
    )
    // A cancelled launch kills uv mid-install; that non-zero exit is the
    // cancellation, not a failure worth showing.
    if (result.code !== 0 && !signal?.aborted) {
      sendOutput(
        `\n${withOutputTail(`⚠ agent requirements install exited with code ${result.code}`, result.output)}\n`
      )
    }
  } catch (err) {
    sendOutput(`⚠ ${AGENT_REQUIREMENTS} failed: ${(err as Error).message}\n`)
  }
}
