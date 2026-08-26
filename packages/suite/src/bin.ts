#!/usr/bin/env node

import { runSuiteCli } from './cli.js'

process.exitCode = await runSuiteCli(process.argv.slice(2))
