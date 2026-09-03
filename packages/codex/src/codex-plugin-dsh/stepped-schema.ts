/**
 * Stepped transport schema generation and decision parsing for the Codex plugin.
 *
 * Constrains the model's final response via `turn/start.outputSchema` to a
 * single decision: either call one declared DSH tool, or finish with a message
 * to the user. DSH executes the decision and returns the tool result in the
 * next step.
 *
 * Wire schemas target OpenAI Structured Outputs strict mode, adhering to five
 * strict-mode vendor rules:
 * 1. The root must be `type: "object"`.
 * 2. `oneOf` is refused; nested `anyOf` is accepted.
 * 3. `const` is refused; single-member `enum` is accepted.
 * 4. `additionalProperties: false` is required on every object.
 * 5. Every property must appear in `required`; optional properties become
 *    nullable unions on the wire.
 *
 * Inverse parsing walks returned arguments alongside the tool's original
 * schema, inverting transport rewrites so DSH sees the exact argument shapes
 * the tool author specified.
 *
 * Internal to this package.
 *
 * @module nishi-dsh-codex/stepped-schema
 */

import { LlmError, type ToolSchema } from '@deepseek-ai/dsh-llm'

/** One decision the model may return under the stepped transport. */
export type CodexDecision =
  | { readonly kind: 'tool_call'; readonly name: string; readonly arguments: Record<string, unknown> }
  | { readonly kind: 'final'; readonly message: string }

const JSON_ENCODED_SUFFIX = 'A JSON value encoded as a string.'

/** Narrow `value` to a plain JSON record (non-null, non-array object). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Format the wire description for an unrepresentable schema node.
 * Includes the original description prefix if present.
 */
function unrepresentableDescription(description: unknown): string {
  if (typeof description === 'string' && description.trim().length > 0) {
    return `${description.trim()} ${JSON_ENCODED_SUFFIX}`
  }
  return JSON_ENCODED_SUFFIX
}

/**
 * Whether a DSH schema node has no strict-mode equivalent.
 *
 * Strict mode requires every object to enumerate its properties and every
 * array to type its items. Schemas that leave values unconstrained cannot
 * be expressed directly in strict mode and are replaced by a JSON-encoded
 * string on the wire.
 *
 * It is true when the node:
 * - has neither `type` nor `oneOf` (an annotation-only schema: any JSON value); or
 * - is `type: "object"` with missing or empty `properties` (a free-form object:
 *   DSH's default is open, so `{type: 'object', properties: {}}` constrains nothing); or
 * - is `type: "array"` with no `items` (any item).
 *
 * Deliberately NOT treated as unrepresentable: an object that has `properties`
 * but also `additionalProperties: true`. Forcing it closed narrows what the
 * model may send while keeping the declared structure visible, which is a
 * better trade than hiding the structure behind a JSON string.
 */
function unrepresentable(node: unknown): boolean {
  if (!isRecord(node)) return false
  // 1. has neither `type` nor `oneOf` (an annotation-only schema: any JSON value)
  if (node.type === undefined && node.oneOf === undefined) return true
  // 2. is `type: "object"` with missing or empty `properties` (a free-form object:
  //    DSH's default is open, so `{type: 'object', properties: {}}` constrains nothing)
  if (
    node.type === 'object' &&
    (node.properties === undefined || (isRecord(node.properties) && Object.keys(node.properties).length === 0))
  ) {
    return true
  }
  // 3. is `type: "array"` with no `items` (any item)
  if (node.type === 'array' && node.items === undefined) return true
  return false
}

/**
 * Whether a schema node permits `null` directly, via a type array containing
 * `"null"`, via literal scalar null, or via any union branch.
 */
function permitsNull(node: unknown): boolean {
  if (!isRecord(node)) return false
  if (node.type === 'null') return true
  if (Array.isArray(node.type) && node.type.includes('null')) return true
  if (node.const === null) return true
  if (Array.isArray(node.enum) && node.enum.includes(null)) return true
  if (Array.isArray(node.oneOf) && node.oneOf.some(permitsNull)) return true
  if (Array.isArray(node.anyOf) && node.anyOf.some(permitsNull)) return true
  return false
}

/**
 * Recursively walk a DSH parameter schema node and produce a strict-mode equivalent.
 *
 * - Rewrites unrepresentable subtrees into JSON-encoded string fields.
 * - Replaces `const: X` with `enum: [X]`.
 * - Weakens `oneOf` to `anyOf` to satisfy vendor strict mode.
 * - Sets `additionalProperties: false` on all objects and requires all declared properties.
 * - Converts optional properties into nullable unions.
 * - Preserves `description` and strips non-wire annotations (`title`, `default`, `examples`).
 */
function rewriteSchemaNode(node: unknown): Record<string, unknown> {
  if (!isRecord(node)) {
    return { type: 'string', description: JSON_ENCODED_SUFFIX }
  }

  if (unrepresentable(node)) {
    return {
      type: 'string',
      description: unrepresentableDescription(node.description),
    }
  }

  if (Array.isArray(node.oneOf)) {
    // This is a deliberate weakening -- `anyOf` accepts a value that satisfies
    // two branches where `oneOf` would not. DSH validates the arguments against
    // the original schema afterwards, so an over-permissive wire schema
    // produces a readable tool error rather than a silent bad call.
    const out: Record<string, unknown> = {
      anyOf: node.oneOf.map(branch => rewriteSchemaNode(branch)),
    }
    if (typeof node.description === 'string') {
      out.description = node.description
    }
    return out
  }

  if (node.type === 'object') {
    const originalProperties = isRecord(node.properties) ? node.properties : {}
    const originalRequired = new Set(
      Array.isArray(node.required)
        ? node.required.filter((key): key is string => typeof key === 'string')
        : [],
    )

    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, propNode] of Object.entries(originalProperties)) {
      const isRequired = originalRequired.has(key)
      const rewrittenProp = rewriteSchemaNode(propNode)

      if (!isRequired && !permitsNull(propNode)) {
        // A property that was NOT in the original `required` becomes nullable:
        // - if its rewritten form has a string `type`, make it `[type, "null"]`;
        // - if its rewritten form has an array `type`, append `"null"` if absent;
        // - if it is an `anyOf` union, append a `{ type: 'null' }` branch;
        // - if it constrains values with `enum`, append `null` to that `enum`
        //   as well, keeping `type` and `enum` consistent so `null` is expressible.
        if (typeof rewrittenProp.type === 'string') {
          rewrittenProp.type = [rewrittenProp.type, 'null']
        } else if (Array.isArray(rewrittenProp.type)) {
          if (!rewrittenProp.type.includes('null')) {
            rewrittenProp.type = [...rewrittenProp.type, 'null']
          }
        } else if (Array.isArray(rewrittenProp.anyOf)) {
          if (!permitsNull(rewrittenProp)) {
            rewrittenProp.anyOf = [...rewrittenProp.anyOf, { type: 'null' }]
          }
        } else {
          // Under DSH's schema subset, every valid node produces a string type,
          // an array type, or an anyOf union; other shapes are unreachable.
        }

        if (Array.isArray(rewrittenProp.enum) && !rewrittenProp.enum.includes(null)) {
          rewrittenProp.enum = [...rewrittenProp.enum, null]
        }
      }

      properties[key] = rewrittenProp
      required.push(key)
    }

    // Deliberately NOT treated as unrepresentable: an object that has properties
    // but also additionalProperties: true. Forcing it closed narrows what the
    // model may send while keeping the declared structure visible, which is a
    // better trade than hiding the structure behind a JSON string.
    const out: Record<string, unknown> = {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    }
    if (typeof node.description === 'string') {
      out.description = node.description
    }
    return out
  }

  if (node.type === 'array') {
    const out: Record<string, unknown> = {
      type: 'array',
      items: rewriteSchemaNode(node.items),
    }
    if (typeof node.description === 'string') {
      out.description = node.description
    }
    return out
  }

  const out: Record<string, unknown> = {}
  if (node.type !== undefined) {
    out.type = Array.isArray(node.type) ? [...node.type] : node.type
  } else if (node.const !== undefined) {
    out.type = typeof node.const === 'number'
      ? (Number.isInteger(node.const) ? 'integer' : 'number')
      : typeof node.const === 'boolean'
        ? 'boolean'
        : node.const === null
          ? 'null'
          : 'string'
  }

  if (node.const !== undefined) {
    out.enum = [node.const]
  } else if (Array.isArray(node.enum)) {
    out.enum = [...node.enum]
  }

  if (typeof node.description === 'string') {
    out.description = node.description
  }

  return out
}

/**
 * The `turn/start.outputSchema` for one exact DSH tool catalog.
 * Returns `undefined` when there are no tools, which is how an auxiliary or
 * toolless request runs unconstrained.
 */
export function codexOutputSchema(
  tools: readonly ToolSchema[] | undefined,
): Record<string, unknown> | undefined {
  if (tools === undefined || tools.length === 0) return undefined

  const toolVariants = tools.map(tool => {
    const variant: Record<string, unknown> = {
      type: 'object',
      additionalProperties: false,
    }
    if (typeof tool.description === 'string' && tool.description.trim().length > 0) {
      variant.description = tool.description
    }
    variant.properties = {
      kind: { type: 'string', enum: ['tool_call'] },
      name: { type: 'string', enum: [tool.name] },
      arguments: rewriteSchemaNode(tool.parameters),
    }
    variant.required = ['kind', 'name', 'arguments']
    return variant
  })

  const finalVariant = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['final'] },
      message: { type: 'string', description: 'The answer to show the user.' },
    },
    required: ['kind', 'message'],
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: {
        anyOf: [...toolVariants, finalVariant],
      },
    },
    required: ['decision'],
  }
}

/**
 * Recursively invert transport rewrites by walking the received value alongside
 * the tool's original schema.
 *
 * Deriving provenance from the original schema rather than from a list of paths
 * recorded during generation is deliberate: a recorded list can drift from what
 * the generator actually did, and a walk cannot.
 */
function invertValue(
  value: unknown,
  schema: unknown,
  toolName: string,
  path: string,
): unknown {
  if (unrepresentable(schema)) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch (error) {
        const pathLabel = path === '' ? 'arguments' : path
        throw new LlmError(
          `codex-plugin-dsh: tool ${JSON.stringify(toolName)} argument ${JSON.stringify(pathLabel)} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          'CODEX_PROTOCOL',
          { cause: error instanceof Error ? error : undefined },
        )
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    const itemSchema = isRecord(schema) ? schema.items : undefined
    return value.map((item, index) =>
      invertValue(item, itemSchema, toolName, `${path}[${index}]`),
    )
  }

  if (isRecord(value)) {
    let resolvedSchema = schema
    if (isRecord(schema) && Array.isArray(schema.oneOf)) {
      const match = schema.oneOf.find(branch => {
        if (!isRecord(branch) || branch.type !== 'object' || !isRecord(branch.properties)) return false
        for (const [k, v] of Object.entries(value)) {
          const prop = branch.properties[k]
          if (isRecord(prop) && prop.const !== undefined && prop.const !== v) {
            return false
          }
        }
        return true
      })
      if (match !== undefined) {
        resolvedSchema = match
      }
    }

    const schemaObj = isRecord(resolvedSchema) ? resolvedSchema : undefined
    const properties = isRecord(schemaObj?.properties) ? schemaObj.properties : {}
    const requiredSet = new Set(
      Array.isArray(schemaObj?.required)
        ? schemaObj.required.filter((k): k is string => typeof k === 'string')
        : [],
    )

    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      const propSchema = properties[key]
      const wasRequired = requiredSet.has(key)

      if (val === null) {
        // At an object node, for each key whose value is null: delete it only
        // if the key was absent from the original required and the original
        // property schema does not itself permit null. Otherwise keep the null.
        if (!wasRequired && !permitsNull(propSchema)) {
          continue
        }
        out[key] = null
        continue
      }

      const childPath = path === '' ? key : `${path}.${key}`
      out[key] = invertValue(val, propSchema, toolName, childPath)
    }
    return out
  }

  return value
}

/**
 * Parse one final-answer text back into a decision, inverting every transport
 * rewrite so DSH sees the arguments the tool's own schema describes.
 */
export function codexDecision(
  text: string,
  tools: readonly ToolSchema[] | undefined,
): CodexDecision {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new LlmError(
      `codex-plugin-dsh: response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'CODEX_PROTOCOL',
      { cause: error instanceof Error ? error : undefined },
    )
  }

  if (!isRecord(parsed)) {
    throw new LlmError('codex-plugin-dsh: response must be a JSON object', 'CODEX_PROTOCOL')
  }

  const decision = parsed.decision
  if (!isRecord(decision)) {
    throw new LlmError('codex-plugin-dsh: response must contain a "decision" object', 'CODEX_PROTOCOL')
  }

  const kind = decision.kind
  if (kind === 'final') {
    if (typeof decision.message !== 'string') {
      throw new LlmError('codex-plugin-dsh: final decision "message" must be a string', 'CODEX_PROTOCOL')
    }
    return {
      kind: 'final',
      message: decision.message,
    }
  }

  if (kind === 'tool_call') {
    if (typeof decision.name !== 'string') {
      throw new LlmError('codex-plugin-dsh: tool_call decision "name" must be a string', 'CODEX_PROTOCOL')
    }

    const tool = tools?.find(t => t.name === decision.name)
    if (tool === undefined) {
      throw new LlmError(
        `codex-plugin-dsh: decision requested unknown tool ${JSON.stringify(decision.name)}`,
        'CODEX_PROTOCOL',
      )
    }

    const rawArguments = decision.arguments
    if (unrepresentable(tool.parameters)) {
      if (typeof rawArguments !== 'string') {
        throw new LlmError(
          `codex-plugin-dsh: tool ${JSON.stringify(tool.name)} arguments must be a JSON-encoded string`,
          'CODEX_PROTOCOL',
        )
      }
      let parsedArgs: unknown
      try {
        parsedArgs = JSON.parse(rawArguments)
      } catch (error) {
        throw new LlmError(
          `codex-plugin-dsh: tool ${JSON.stringify(tool.name)} argument "arguments" contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          'CODEX_PROTOCOL',
          { cause: error instanceof Error ? error : undefined },
        )
      }
      if (!isRecord(parsedArgs)) {
        throw new LlmError(
          `codex-plugin-dsh: tool ${JSON.stringify(tool.name)} arguments must decode to an object`,
          'CODEX_PROTOCOL',
        )
      }
      return {
        kind: 'tool_call',
        name: tool.name,
        arguments: parsedArgs,
      }
    }

    if (!isRecord(rawArguments)) {
      throw new LlmError(
        `codex-plugin-dsh: tool_call decision "arguments" must be an object`,
        'CODEX_PROTOCOL',
      )
    }

    const restoredArguments = invertValue(rawArguments, tool.parameters, tool.name, '')
    if (!isRecord(restoredArguments)) {
      throw new LlmError(
        `codex-plugin-dsh: tool ${JSON.stringify(tool.name)} arguments must be an object`,
        'CODEX_PROTOCOL',
      )
    }

    return {
      kind: 'tool_call',
      name: tool.name,
      arguments: restoredArguments,
    }
  }

  throw new LlmError(
    `codex-plugin-dsh: unsupported decision kind ${JSON.stringify(kind)}`,
    'CODEX_PROTOCOL',
  )
}
