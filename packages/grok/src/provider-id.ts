/**
 * The provider id, alone in a module because both the adapter and the prompt
 * wire need it and neither may import the other: `isOwnReply` asks whether an
 * assistant message came from THIS route, which is a question about the id
 * rather than about the adapter that answers to it.
 *
 * @module nishi-dsh-grok/provider-id
 */

/** DSH provider id for the Grok Build CLI primary route. */
export const GROK_PRIMARY_PROVIDER = 'grok-cli'
