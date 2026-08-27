export async function load(url, context, nextLoad) {
  if (url.endsWith('.css') || url.includes('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (t, p) => String(p) });',
    }
  }

  return nextLoad(url, context)
}
