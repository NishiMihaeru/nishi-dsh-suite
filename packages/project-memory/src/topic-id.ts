export const TOPIC_IDENTIFIER_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const MAX_TOPIC_IDENTIFIER_LENGTH = 64

export const RESERVED_TOPIC_IDENTIFIERS = new Set<string>([
  'memory',
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/** Validate the approved flat topic identifier contract. */
export function isValidTopicIdentifier(topic: string): boolean {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > MAX_TOPIC_IDENTIFIER_LENGTH) {
    return false
  }
  if (RESERVED_TOPIC_IDENTIFIERS.has(topic.toLowerCase())) {
    return false
  }
  return TOPIC_IDENTIFIER_REGEX.test(topic)
}
