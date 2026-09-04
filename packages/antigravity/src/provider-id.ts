/**
 * The provider id, alone in a module because both the adapter and the bridge
 * wire need it and neither may import the other: `isOwnReply` asks whether an
 * assistant message came from THIS route, which is a question about the id
 * rather than about the adapter that answers to it.
 *
 * @module nishi-dsh-antigravity/provider-id
 */

/** DSH provider id for the Antigravity CLI primary route. */
export const ANTIGRAVITY_PRIMARY_PROVIDER = 'antigravity-cli'
