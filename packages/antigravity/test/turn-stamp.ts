/**
 * Echo the envelope's per-turn stamp back, the way a conforming model does.
 *
 * The adapter discards a decision whose `turn` field is not the one this
 * turn's envelope carried, because the real vendor leaves the PREVIOUS turn's
 * `structured_output` in place when a turn produces none of its own -- see
 * `docs/verification/agy-cli-contract.md` and `BRIDGE_TURN_FIELD`. Every fake
 * vendor in this suite therefore has to stamp its replies or every schema-path
 * test fails on the guard rather than on what it is about.
 *
 * Shared rather than copied into each fake on purpose: three copies of the
 * rule "the reply echoes the envelope" is exactly the kind of duplication that
 * drifts in meaning, and a fake that stops echoing would look like a product
 * defect. A fixture that wants to EXERCISE the guard supplies its own `turn`,
 * which is kept untouched.
 *
 * @module
 */

/** The `turn` value carried by one NDJSON input line, if it carries one. */
export function envelopeTurn(inputLine: string): string | undefined {
  try {
    const outer = JSON.parse(inputLine) as { message?: { content?: unknown } }
    const content = outer.message?.content
    if (typeof content !== 'string') return undefined
    const envelope = JSON.parse(content) as Record<string, unknown>
    return typeof envelope.turn === 'string' ? envelope.turn : undefined
  } catch {
    return undefined
  }
}

/**
 * A fixture's stand-in for a stamp only the adapter knows.
 *
 * Every occurrence is substituted for the real one, which is how a fixture
 * pins the CONTENT of a reply -- a decision in the turn's `response` text,
 * say -- that has to be stamped for this turn to be read at all.
 */
export const TURN_PLACEHOLDER = '__TURN__'

/** Stamp one `result` payload with the turn of the line being answered. */
export function stamped(reply: unknown, inputLine: string): unknown {
  if (reply === null || typeof reply !== 'object') return reply
  const turn = envelopeTurn(inputLine)
  if (turn === undefined) return reply

  const serialized = JSON.stringify(reply)
  const row = (serialized.includes(TURN_PLACEHOLDER)
    ? JSON.parse(serialized.split(TURN_PLACEHOLDER).join(turn))
    : reply) as Record<string, unknown>

  const structured = row.structured_output
  if (structured === null || typeof structured !== 'object') return row
  const decision = structured as Record<string, unknown>
  if ('turn' in decision) return row
  return { ...row, structured_output: { ...decision, turn } }
}

/** Stamp one already-serialized vendor stdout line; anything else passes through. */
export function stampedLine(line: string, inputLine: string): string {
  let event: { event?: unknown; result?: unknown }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return line
  }
  if (event.event !== 'result') return line
  return JSON.stringify({ ...event, result: stamped(event.result, inputLine) })
}
