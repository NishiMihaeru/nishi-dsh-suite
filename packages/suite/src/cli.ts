import {
  installOrchestratorPreset,
  inspectOrchestratorPreset,
  removeOrchestratorPreset,
  updateOrchestratorPreset,
  type OrchestratorPresetOptions,
  type OrchestratorPresetResult,
} from './preset-manager.js'

const USAGE = `Usage:
  nishi-dsh-suite preset install
  nishi-dsh-suite preset status
  nishi-dsh-suite preset update
  nishi-dsh-suite preset remove

The preset commands only manage $DSH_HOME/.agent-presets/orchestrator.
When DSH_HOME is unset, DeepSeek Harness uses ~/.dsh.`

export interface SuiteCliIo {
  stdout?: (message: string) => void
  stderr?: (message: string) => void
  env?: Record<string, string | undefined>
}

function writeStdout(io: SuiteCliIo, message: string): void {
  ;(io.stdout ?? console.log)(message)
}

function writeStderr(io: SuiteCliIo, message: string): void {
  ;(io.stderr ?? console.error)(message)
}

function managerOptions(io: SuiteCliIo): OrchestratorPresetOptions {
  const env = io.env ?? process.env
  const dshHome = env.DSH_HOME
  return dshHome !== undefined && dshHome.trim().length > 0 ? { dshHome } : {}
}

function formatResult(result: OrchestratorPresetResult): string {
  return `Orchestrator preset: ${result.state}\nPath: ${result.target}`
}

async function runPresetAction(action: string, io: SuiteCliIo): Promise<number> {
  const options = managerOptions(io)

  try {
    if (action === 'status') {
      writeStdout(io, formatResult(await inspectOrchestratorPreset(options)))
      return 0
    }
    if (action === 'install') {
      const result = await installOrchestratorPreset(options)
      writeStdout(io, `${result.changed ? 'Installed' : 'Already current'} Orchestrator preset.\n${formatResult(result)}`)
      return 0
    }
    if (action === 'update') {
      const result = await updateOrchestratorPreset(options)
      writeStdout(io, `${result.changed ? 'Updated' : 'Already current'} Orchestrator preset.\n${formatResult(result)}`)
      return 0
    }
    if (action === 'remove') {
      const result = await removeOrchestratorPreset(options)
      writeStdout(io, `${result.changed ? 'Removed' : 'Already absent'} Orchestrator preset.\n${formatResult(result)}`)
      return 0
    }
  } catch (error) {
    writeStderr(io, `nishi-dsh-suite: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  writeStderr(io, USAGE)
  return 2
}

export async function runSuiteCli(args: readonly string[], io: SuiteCliIo = {}): Promise<number> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === 'help')) {
    writeStdout(io, USAGE)
    return 0
  }

  if (args.length === 2 && args[0] === 'preset') {
    return runPresetAction(args[1] ?? '', io)
  }

  writeStderr(io, USAGE)
  return 2
}
