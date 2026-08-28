import type {
  ConnectionRpcHandler,
  HostConnectionRpc,
} from '@deepseek-ai/dsh-client-connection'

interface LegacyTrustedHostHandle {
  (
    channel: string,
    handler: ConnectionRpcHandler,
    options: { readonly authority: 'trusted-host' },
  ): unknown
}

interface AuthenticatedHandle {
  (channel: string, handler: ConnectionRpcHandler): unknown
}

/**
 * Register one Core RPC channel across the DSH Connection API transition.
 *
 * DSH 0.1.1-rc.2 requires a third `{ authority: 'trusted-host' }` argument.
 * DSH 0.1.2-alpha.1 moved trust + browser authentication fully into
 * Connection and exposes the authenticated two-argument form. The published
 * function arities are 3 and 2 respectively, so keep this compatibility seam
 * isolated here while the Suite supports/probes both generations.
 *
 * Connection owns the returned disposer through the caller Context's effect;
 * Core deliberately does not add a second lifecycle owner.
 */
export function registerConnectionRpcChannel(
  rpc: Pick<HostConnectionRpc, 'handle'>,
  channel: string,
  handler: ConnectionRpcHandler,
): void {
  const handle = rpc.handle as unknown as AuthenticatedHandle & LegacyTrustedHostHandle

  if (handle.length >= 3) {
    ;(handle as LegacyTrustedHostHandle)(channel, handler, { authority: 'trusted-host' })
    return
  }

  ;(handle as AuthenticatedHandle)(channel, handler)
}
