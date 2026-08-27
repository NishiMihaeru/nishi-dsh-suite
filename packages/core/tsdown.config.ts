import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type Plugin } from 'tsdown'

export const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

export const PRELOADED_CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime/client',
] as const

export const RC2_BROWSER_SEED_EXTERNALS = [
  ...PLATFORM_MODULES,
  ...PRELOADED_CLIENT_EXTERNALS,
] as const

export function dshClientPurityGatePlugin(): Plugin {
  const allowedExternalSet = new Set<string>(RC2_BROWSER_SEED_EXTERNALS)
  const retiredPackages = new Set<string>([
    '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-web-react/store',
  ])
  return {
    name: 'dsh-client-purity-gate',
    resolveId(source) {
      if (retiredPackages.has(source)) {
        throw new Error(`[Build Purity Gate] Forbidden import of retired rc.6 platform package: "${source}"`)
      }
      if (source.startsWith('@deepseek-ai/') && !allowedExternalSet.has(source)) {
        throw new Error(`[Build Purity Gate] Forbidden cross-plugin value import of unseeded platform module: "${source}"`)
      }
      if (source.startsWith('nishi-dsh-')) {
        throw new Error(`[Build Purity Gate] Forbidden cross-plugin value import of unbundled plugin module: "${source}"`)
      }
      if (source.startsWith('@dsh-plugin/')) {
        throw new Error(`[Build Purity Gate] Legacy private package import is forbidden: "${source}"`)
      }
      return null
    },
  }
}

function dshLightningCssModulesPlugin(): Plugin {
  return {
    name: 'dsh-lightningcss-modules',
    resolveId(source, importer) {
      if (source.endsWith('.module.css') || source.includes('.module.css')) {
        const resolved = importer ? resolve(dirname(importer), source) : resolve(source)
        return { id: resolved + '.inline.js', moduleSideEffects: true }
      }
      return null
    },
    load(id) {
      if (!id.includes('.module.css.inline.js')) return null
      const realCssPath = id.replace(/\.inline\.js$/, '')
      this.addWatchFile(realCssPath)
      const sourceBuffer = readFileSync(realCssPath)
      const fileKey = realCssPath.split(/[/|\\]/).pop()!.replace(/\.module\.css$/, '')
      const cssId = `nishi-dsh-core:${fileKey}`
      const { code, exports: cssExports } = transform({
        filename: realCssPath,
        code: sourceBuffer,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      if (cssExports) {
        for (const [local, exp] of Object.entries(cssExports)) classMap[local] = exp.name
      }
      const js = `
function __injectStyle(id, css) {
  var doc = (typeof document !== 'undefined') ? document : ((typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null);
  if (doc && doc.createElement) {
    var el = doc.querySelector('style[data-plugin="nishi-dsh-core"][data-plugin-css="' + id + '"]');
    if (!el) {
      el = doc.createElement('style');
      el.setAttribute('data-plugin', 'nishi-dsh-core');
      el.setAttribute('data-plugin-css', id);
      el.textContent = css;
      doc.head.appendChild(el);
    }
  }
}
__injectStyle(${JSON.stringify(cssId)}, ${JSON.stringify(code.toString())});
export default ${JSON.stringify(classMap)};
`
      return { code: js, map: { mappings: '' } }
    },
  }
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts', runtime: 'src/runtime/index.ts' },
    format: 'esm',
    platform: 'node',
    dts: true,
    clean: false,
    outDir: 'lib',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    dts: true,
    clean: false,
    outDir: 'lib',
    plugins: [dshClientPurityGatePlugin(), dshLightningCssModulesPlugin()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'process.env': '{}',
    },
    deps: {
      neverBundle: [...RC2_BROWSER_SEED_EXTERNALS],
      alwaysBundle: ['use-sync-external-store'],
    },
    banner:
      'window.__ModuleLoader__.load({\n  id: "nishi-dsh-core",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n',
    footer: '    return module.exports;\n  }\n});\n',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
])
