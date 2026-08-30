import type {
  ConnectionRpcHandler,
  HostConnectionRpc,
} from '@deepseek-ai/dsh-client-connection'

/**
 * Register one Core RPC channel on the DSH Connection API.
 *
 * DSH 0.1.2-alpha.1 moved trust + browser authentication fully into
 * Connection and exposes the authenticated two-argument
 * `rpc.handle(channel, handler)` form; the legacy rc.2 three-argument
 * `{ authority: 'trusted-host' }` form is no longer supported and this
 * function no longer probes for it. The seam stays as a named function,
 * shared by the two call sites below, purely to keep the ownership
 * contract documented in one place.
 *
 * Connection owns the returned disposer through the caller Context's effect;
 * Core deliberately does not add a second lifecycle owner.
 */
export function registerConnectionRpcChannel(
  rpc: Pick<HostConnectionRpc, 'handle'>,
  channel: string,
  handler: ConnectionRpcHandler,
): void {
  rpc.handle(channel, handler)
}
