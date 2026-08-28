import {
  editProjectMemoryBootstrap,
  editTopicMemory,
  ensureMemoryMapEntry,
  initializeDshProject,
  writeProjectMemoryBootstrap,
  writeTopicMemory,
} from '../../src/index.ts'

const [operation, projectRoot, ...args] = process.argv.slice(2)

if (!operation || !projectRoot) {
  throw new Error('rmw-worker: operation and projectRoot are required')
}

process.stdout.write('READY\n')

switch (operation) {
  case 'memory-map':
    await ensureMemoryMapEntry(projectRoot, args[0])
    break
  case 'bootstrap-edit':
    await editProjectMemoryBootstrap(projectRoot, args[0], args[1])
    break
  case 'bootstrap-write':
    await writeProjectMemoryBootstrap(projectRoot, args[0])
    break
  case 'topic-edit':
    await editTopicMemory(projectRoot, args[0], args[1], args[2])
    break
  case 'topic-write':
    await writeTopicMemory(projectRoot, args[0], args[1])
    break
  case 'init':
    await initializeDshProject(projectRoot)
    break
  default:
    throw new Error(`rmw-worker: unsupported operation "${operation}"`)
}

process.stdout.write('DONE\n')
