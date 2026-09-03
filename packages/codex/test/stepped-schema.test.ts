import assert from 'node:assert/strict'
import test from 'node:test'
import { LlmError, type ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  codexDecision,
  codexOutputSchema,
  type CodexDecision,
} from '../src/codex-plugin-dsh/stepped-schema.js'

/** Narrow unknown value to record for strict assertions without type widening. */
function asRecord(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a record')
  return value as Record<string, unknown>
}

/** Narrow unknown value to array of records for strict assertions. */
function asRecordArray(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value), 'expected an array')
  return value.map(asRecord)
}

test('absent or empty tool catalog produces undefined wire schema', () => {
  assert.equal(codexOutputSchema(undefined), undefined)
  assert.equal(codexOutputSchema([]), undefined)
})

test('catalog with one tool produces decision schema pairing tool call and final answer variants', () => {
  const tools: ToolSchema[] = [{
    name: 'file_search',
    description: 'Find files across the workspace',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
      },
      required: ['pattern'],
    },
  }]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)
  const root = asRecord(schema)
  assert.equal(root.type, 'object')
  assert.equal(root.additionalProperties, false)
  assert.deepEqual(root.required, ['decision'])

  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const variants = asRecordArray(decisionProp.anyOf)
  assert.equal(variants.length, 2)

  // Tool variant
  const toolVariant = variants[0]
  assert.equal(toolVariant.type, 'object')
  assert.equal(toolVariant.additionalProperties, false)
  assert.equal(toolVariant.description, 'Find files across the workspace')
  assert.deepEqual(toolVariant.required, ['kind', 'name', 'arguments'])
  const toolProps = asRecord(toolVariant.properties)
  assert.deepEqual(toolProps.kind, { type: 'string', enum: ['tool_call'] })
  assert.deepEqual(toolProps.name, { type: 'string', enum: ['file_search'] })

  // Final variant
  const finalVariant = variants[1]
  assert.equal(finalVariant.type, 'object')
  assert.equal(finalVariant.additionalProperties, false)
  assert.deepEqual(finalVariant.required, ['kind', 'message'])
  const finalProps = asRecord(finalVariant.properties)
  assert.deepEqual(finalProps.kind, { type: 'string', enum: ['final'] })
  assert.deepEqual(finalProps.message, { type: 'string', description: 'The answer to show the user.' })
})

test('all object subtrees throughout the generated schema are closed and exhaustively list required properties', () => {
  const tools: ToolSchema[] = [{
    name: 'complex_tool',
    description: 'Complex nested tool',
    parameters: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            retries: { type: 'number' },
            nested: {
              type: 'object',
              properties: {
                flag: { type: 'boolean' },
              },
            },
          },
          required: ['retries'],
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['id'],
          },
        },
      },
      required: ['config'],
    },
  }]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)

  function verifyStrictObject(node: unknown, path: string): void {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((child, index) => verifyStrictObject(child, `${path}[${index}]`))
      return
    }

    const obj = node as Record<string, unknown>
    if (obj.type === 'object' || (Array.isArray(obj.type) && obj.type.includes('object'))) {
      assert.equal(
        obj.additionalProperties,
        false,
        `object at "${path}" must set additionalProperties: false`,
      )
      assert.equal(
        Array.isArray(obj.required),
        true,
        `object at "${path}" must declare required array`,
      )
      const propKeys = (obj.properties !== null && typeof obj.properties === 'object' && !Array.isArray(obj.properties)
        ? Object.keys(obj.properties as Record<string, unknown>)
        : []
      ).sort()
      const reqKeys = ((obj.required as string[]) ?? []).slice().sort()
      assert.deepEqual(
        reqKeys,
        propKeys,
        `object at "${path}" must require every declared property`,
      )
    }

    for (const [k, v] of Object.entries(obj)) {
      verifyStrictObject(v, `${path}.${k}`)
    }
  }

  verifyStrictObject(schema, 'root')
})

test('optional properties are converted into nullable unions and included in required list', () => {
  const tools: ToolSchema[] = [{
    name: 'editor',
    description: 'File editor',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string' },
        lineCount: { type: 'integer' },
      },
      required: ['path'],
    },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)
  const argProps = asRecord(argsSchema.properties)

  assert.deepEqual(argsSchema.required, ['path', 'encoding', 'lineCount'])
  assert.deepEqual(argProps.path, { type: 'string' })
  assert.deepEqual(argProps.encoding, { type: ['string', 'null'] })
  assert.deepEqual(argProps.lineCount, { type: ['integer', 'null'] })
})

test('const keywords convert to single-element enums and oneOf unions weaken to anyOf', () => {
  const tools: ToolSchema[] = [{
    name: 'runner',
    description: 'Task runner',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          const: 'execute',
        },
        payload: {
          oneOf: [
            { type: 'string' },
            { type: 'number' },
          ],
        },
      },
      required: ['action', 'payload'],
    },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)
  const argProps = asRecord(argsSchema.properties)

  // const -> enum
  const actionProp = asRecord(argProps.action)
  assert.equal(actionProp.const, undefined)
  assert.deepEqual(actionProp.enum, ['execute'])
  assert.equal(actionProp.type, 'string')

  // oneOf -> anyOf
  const payloadProp = asRecord(argProps.payload)
  assert.equal(payloadProp.oneOf, undefined)
  assert.equal(Array.isArray(payloadProp.anyOf), true)
  assert.deepEqual(payloadProp.anyOf, [
    { type: 'string' },
    { type: 'number' },
  ])
})

test('documentation annotations are stripped from wire schema while descriptions are preserved', () => {
  const tools: ToolSchema[] = [{
    name: 'annotated_tool',
    description: 'Tool with rich metadata',
    parameters: {
      type: 'object',
      description: 'Arguments container',
      properties: {
        query: {
          type: 'string',
          title: 'Search Query',
          description: 'Search pattern to execute',
          default: 'default_pattern',
          examples: ['foo', 'bar'],
        },
      },
      required: ['query'],
    },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)

  assert.equal(argsSchema.description, 'Arguments container')
  const queryProp = asRecord(asRecord(argsSchema.properties).query)
  assert.equal(queryProp.description, 'Search pattern to execute')
  assert.equal(queryProp.title, undefined)
  assert.equal(queryProp.default, undefined)
  assert.equal(queryProp.examples, undefined)
})

test('unrepresentable schema subtrees are mapped to string-typed fields with JSON-encoded descriptions', () => {
  const tools: ToolSchema[] = [{
    name: 'dynamic_tool',
    description: 'Tool accepting arbitrary structures',
    parameters: {
      type: 'object',
      properties: {
        anyVal: {
          description: 'Arbitrary value.',
        },
        freeObj: {
          type: 'object',
          description: 'Free-form bag of options.',
        },
        freeArr: {
          type: 'array',
        },
      },
      required: ['anyVal', 'freeObj', 'freeArr'],
    },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)
  const argProps = asRecord(argsSchema.properties)

  // Shape 1: neither type nor oneOf
  const anyVal = asRecord(argProps.anyVal)
  assert.equal(anyVal.type, 'string')
  assert.equal(anyVal.description, 'Arbitrary value. A JSON value encoded as a string.')

  // Shape 2: type: 'object' with no properties
  const freeObj = asRecord(argProps.freeObj)
  assert.equal(freeObj.type, 'string')
  assert.equal(freeObj.description, 'Free-form bag of options. A JSON value encoded as a string.')

  // Shape 3: type: 'array' with no items
  const freeArr = asRecord(argProps.freeArr)
  assert.equal(freeArr.type, 'string')
  assert.equal(freeArr.description, 'A JSON value encoded as a string.')
})

test('objects declaring both properties and additionalProperties true remain structured with additionalProperties closed', () => {
  const tools: ToolSchema[] = [{
    name: 'open_object_tool',
    description: 'Tool with open object parameter',
    parameters: {
      type: 'object',
      properties: {
        knownField: { type: 'string' },
      },
      additionalProperties: true,
      required: ['knownField'],
    },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)

  assert.equal(argsSchema.type, 'object')
  assert.equal(argsSchema.additionalProperties, false)
  assert.deepEqual(Object.keys(asRecord(argsSchema.properties)), ['knownField'])
})

test('omitted optional properties returned as null by the model are deleted from final arguments', () => {
  const tools: ToolSchema[] = [{
    name: 'config_tool',
    description: 'Config tool',
    parameters: {
      type: 'object',
      properties: {
        mandatory: { type: 'string' },
        optionalField: { type: 'string' },
        nested: {
          type: 'object',
          properties: {
            innerOpt: { type: 'number' },
            innerReq: { type: 'boolean' },
          },
          required: ['innerReq'],
        },
      },
      required: ['mandatory'],
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'config_tool',
      arguments: {
        mandatory: 'defined',
        optionalField: null,
        nested: {
          innerOpt: null,
          innerReq: true,
        },
      },
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.equal(decision.name, 'config_tool')
    assert.equal('optionalField' in decision.arguments, false)
    assert.equal(decision.arguments.mandatory, 'defined')
    const nested = asRecord(decision.arguments.nested)
    assert.equal('innerOpt' in nested, false)
    assert.equal(nested.innerReq, true)
  }
})

test('optional properties whose original schema permits null retain explicit null', () => {
  const tools: ToolSchema[] = [{
    name: 'nullable_tool',
    description: 'Nullable tool',
    parameters: {
      type: 'object',
      properties: {
        optTypeArray: { type: ['string', 'null'] },
        optPureNull: { type: 'null' },
        optOneOfNull: {
          oneOf: [
            { type: 'string' },
            { type: 'null' },
          ],
        },
      },
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'nullable_tool',
      arguments: {
        optTypeArray: null,
        optPureNull: null,
        optOneOfNull: null,
      },
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.equal('optTypeArray' in decision.arguments, true)
    assert.equal(decision.arguments.optTypeArray, null)

    assert.equal('optPureNull' in decision.arguments, true)
    assert.equal(decision.arguments.optPureNull, null)

    assert.equal('optOneOfNull' in decision.arguments, true)
    assert.equal(decision.arguments.optOneOfNull, null)
  }
})

test('required properties carrying null retain explicit null', () => {
  const tools: ToolSchema[] = [{
    name: 'strict_tool',
    description: 'Strict tool',
    parameters: {
      type: 'object',
      properties: {
        requiredVal: { type: 'string' },
      },
      required: ['requiredVal'],
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'strict_tool',
      arguments: {
        requiredVal: null,
      },
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.equal('requiredVal' in decision.arguments, true)
    assert.equal(decision.arguments.requiredVal, null)
  }
})

test('null items within arrays survive the inverse restoration walk', () => {
  const tools: ToolSchema[] = [{
    name: 'list_tool',
    description: 'List tool',
    parameters: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['entries'],
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'list_tool',
      arguments: {
        entries: ['first', null, 'third'],
      },
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.deepEqual(decision.arguments.entries, ['first', null, 'third'])
  }
})

test('string-encoded unrepresentable subtrees round-trip objects, arrays, and bare scalars', () => {
  const tools: ToolSchema[] = [{
    name: 'dynamic_eval',
    description: 'Evaluator',
    parameters: {
      type: 'object',
      properties: {
        objData: { type: 'object' },
        arrData: { type: 'array' },
        scalarStr: {},
        scalarNum: {},
        scalarBool: {},
      },
      required: ['objData', 'arrData', 'scalarStr', 'scalarNum', 'scalarBool'],
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'dynamic_eval',
      arguments: {
        objData: JSON.stringify({ key: 'val', num: 100 }),
        arrData: JSON.stringify([1, 'two', { nested: true }]),
        scalarStr: JSON.stringify('plain text'),
        scalarNum: JSON.stringify(42.5),
        scalarBool: JSON.stringify(true),
      },
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.deepEqual(decision.arguments.objData, { key: 'val', num: 100 })
    assert.deepEqual(decision.arguments.arrData, [1, 'two', { nested: true }])
    assert.equal(decision.arguments.scalarStr, 'plain text')
    assert.equal(decision.arguments.scalarNum, 42.5)
    assert.equal(decision.arguments.scalarBool, true)
  }
})

test('tool with free-form root parameters accepts and decodes string-encoded arguments object', () => {
  const tools: ToolSchema[] = [{
    name: 'free_form_tool',
    description: 'Tool accepting arbitrary arguments object',
    parameters: { type: 'object' },
  }]

  const schema = codexOutputSchema(tools)
  const root = asRecord(schema)
  const properties = asRecord(root.properties)
  const decisionProp = asRecord(properties.decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const toolProps = asRecord(toolVariant.properties)
  const argsSchema = asRecord(toolProps.arguments)
  assert.equal(argsSchema.type, 'string')

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'free_form_tool',
      arguments: JSON.stringify({ anyKey: 'anyValue', count: 5 }),
    },
  })

  const decision = codexDecision(rawAnswer, tools)
  assert.equal(decision.kind, 'tool_call')
  if (decision.kind === 'tool_call') {
    assert.deepEqual(decision.arguments, { anyKey: 'anyValue', count: 5 })
  }
})

test('invalid JSON string within unrepresentable subtree throws LlmError identifying tool and path', () => {
  const tools: ToolSchema[] = [{
    name: 'db_insert',
    description: 'Insert record',
    parameters: {
      type: 'object',
      properties: {
        recordPayload: { type: 'object' },
      },
      required: ['recordPayload'],
    },
  }]

  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'tool_call',
      name: 'db_insert',
      arguments: {
        recordPayload: '{ corrupted json: true',
      },
    },
  })

  assert.throws(
    () => codexDecision(rawAnswer, tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.equal(err.code, 'CODEX_PROTOCOL')
      assert.match(err.message, /^codex-plugin-dsh:/)
      assert.match(err.message, /db_insert/)
      assert.match(err.message, /recordPayload/)
      return true
    },
  )
})

test('final answer decision produces structured completion message', () => {
  const rawAnswer = JSON.stringify({
    decision: {
      kind: 'final',
      message: 'Here is the requested explanation.',
    },
  })

  const decision = codexDecision(rawAnswer, undefined)
  assert.deepEqual(decision, {
    kind: 'final',
    message: 'Here is the requested explanation.',
  })
})

test('malformed JSON, invalid structures, and unregistered tools throw descriptive LlmError failures', () => {
  const tools: ToolSchema[] = [{
    name: 'registered_tool',
    description: 'A registered tool',
    parameters: { type: 'object', properties: {} },
  }]

  // Non-JSON input
  assert.throws(
    () => codexDecision('not json', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Non-object JSON root
  assert.throws(
    () => codexDecision('["array"]', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Missing decision property
  assert.throws(
    () => codexDecision('{"status": "ok"}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Unknown decision kind
  assert.throws(
    () => codexDecision('{"decision": {"kind": "noop"}}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Final kind without string message
  assert.throws(
    () => codexDecision('{"decision": {"kind": "final", "message": 123}}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Tool call with unknown tool name
  assert.throws(
    () => codexDecision('{"decision": {"kind": "tool_call", "name": "unknown_tool", "arguments": {}}}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      assert.match(err.message, /unknown_tool/)
      return true
    },
  )

  // Tool call with non-object arguments
  assert.throws(
    () => codexDecision('{"decision": {"kind": "tool_call", "name": "registered_tool", "arguments": 123}}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )

  // Tool call with non-string name
  assert.throws(
    () => codexDecision('{"decision": {"kind": "tool_call", "name": 123, "arguments": {}}}', tools),
    (err: unknown) => {
      assert(err instanceof LlmError)
      assert.match(err.message, /^codex-plugin-dsh:/)
      return true
    },
  )
})

test('optional enum and const properties permit null in both type and enum on wire and are deleted when returned as null', () => {
  const tools: ToolSchema[] = [{
    name: 'agent_tool',
    description: 'Agent management tool',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        scope: {
          type: 'string',
          enum: ['children', 'descendants'],
          description: 'Scope.',
        },
        mode: {
          type: 'string',
          const: 'autonomous',
          description: 'Execution mode.',
        },
      },
      required: ['id'],
    },
  }]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)
  const root = asRecord(schema)
  const decisionProp = asRecord(asRecord(root.properties).decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const argsSchema = asRecord(asRecord(toolVariant.properties).arguments)
  const argProps = asRecord(argsSchema.properties)

  // 1. Check wire schema for optional enum property: permits null in both type and enum
  const scopeProp = asRecord(argProps.scope)
  assert.deepEqual(scopeProp.type, ['string', 'null'])
  assert.deepEqual(scopeProp.enum, ['children', 'descendants', null])

  // 2. Check wire schema for optional const property: permits null in both type and enum
  const modeProp = asRecord(argProps.mode)
  assert.deepEqual(modeProp.type, ['string', 'null'])
  assert.deepEqual(modeProp.enum, ['autonomous', null])

  // 3. When model returns null for optional enum or const, inverse walk deletes the key
  const nullDecision = codexDecision(
    JSON.stringify({
      decision: {
        kind: 'tool_call',
        name: 'agent_tool',
        arguments: {
          id: 'agent-123',
          scope: null,
          mode: null,
        },
      },
    }),
    tools,
  )
  assert.equal(nullDecision.kind, 'tool_call')
  if (nullDecision.kind === 'tool_call') {
    assert.equal(nullDecision.name, 'agent_tool')
    assert.equal(nullDecision.arguments.id, 'agent-123')
    assert.equal('scope' in nullDecision.arguments, false)
    assert.equal('mode' in nullDecision.arguments, false)
  }

  // 4. When model supplies valid values, inverse walk preserves them
  const setDecision = codexDecision(
    JSON.stringify({
      decision: {
        kind: 'tool_call',
        name: 'agent_tool',
        arguments: {
          id: 'agent-123',
          scope: 'children',
          mode: 'autonomous',
        },
      },
    }),
    tools,
  )
  assert.equal(setDecision.kind, 'tool_call')
  if (setDecision.kind === 'tool_call') {
    assert.equal(setDecision.arguments.id, 'agent-123')
    assert.equal(setDecision.arguments.scope, 'children')
    assert.equal(setDecision.arguments.mode, 'autonomous')
  }
})

/**
 * Reusable walk that asserts that every property optional in the source schema
 * is expressible as null on the wire:
 * 1. Its wire type permits null (directly, via a type array containing "null", or via an anyOf union branch).
 * 2. If it carries an enum, that enum contains null.
 */
function assertOptionalPropertiesPermitNull(
  source: unknown,
  wire: unknown,
  path = 'root',
): void {
  if (source === null || typeof source !== 'object' || wire === null || typeof wire !== 'object') {
    return
  }

  const src = source as Record<string, unknown>
  const wr = wire as Record<string, unknown>

  if (src.type === 'object' && src.properties !== null && typeof src.properties === 'object') {
    const srcProps = src.properties as Record<string, unknown>
    const srcReq = new Set(
      Array.isArray(src.required)
        ? src.required.filter((k): k is string => typeof k === 'string')
        : [],
    )
    const wrProps = (wr.properties !== null && typeof wr.properties === 'object'
      ? wr.properties
      : {}) as Record<string, unknown>

    for (const [key, propSource] of Object.entries(srcProps)) {
      const propWire = wrProps[key]
      const propPath = `${path}.${key}`
      assert(propWire !== undefined, `expected wire schema to have property "${propPath}"`)
      const wrPropRec = propWire as Record<string, unknown>

      const wasOptional = !srcReq.has(key)
      if (wasOptional) {
        const typePermitsNull =
          wrPropRec.type === 'null' ||
          (Array.isArray(wrPropRec.type) && wrPropRec.type.includes('null')) ||
          (Array.isArray(wrPropRec.anyOf) &&
            wrPropRec.anyOf.some(branch => {
              if (branch === null || typeof branch !== 'object') return false
              const b = branch as Record<string, unknown>
              return b.type === 'null' || (Array.isArray(b.type) && b.type.includes('null'))
            }))

        assert.equal(
          typePermitsNull,
          true,
          `optional property "${propPath}" must permit null in its wire type or anyOf`,
        )

        if (Array.isArray(wrPropRec.enum)) {
          assert.equal(
            wrPropRec.enum.includes(null),
            true,
            `optional property "${propPath}" carries an enum and must include null`,
          )
        }
      }

      assertOptionalPropertiesPermitNull(propSource, propWire, propPath)
    }
  }

  if (src.type === 'array' && src.items !== undefined && wr.items !== undefined) {
    assertOptionalPropertiesPermitNull(src.items, wr.items, `${path}[]`)
  }

  if (Array.isArray(src.oneOf) && Array.isArray(wr.anyOf)) {
    src.oneOf.forEach((branch, index) => {
      assertOptionalPropertiesPermitNull(branch, wr.anyOf[index], `${path}.oneOf[${index}]`)
    })
  }
}

test('general invariant: all optional properties across various shapes permit null in type and enum on the wire', () => {
  const tools: ToolSchema[] = [{
    name: 'multi_shape_tool',
    description: 'Catalog tool exercising various optional parameter shapes',
    parameters: {
      type: 'object',
      properties: {
        reqScalar: { type: 'string', description: 'Required string' },
        // Plain scalar optional
        optScalar: { type: 'number', description: 'Optional number' },
        // Enum optional
        optEnum: { type: 'string', enum: ['alpha', 'beta'], description: 'Optional enum' },
        // Const optional
        optConst: { type: 'string', const: 'fixed_val', description: 'Optional const' },
        // Object optional with nested required and optional properties
        optObject: {
          type: 'object',
          properties: {
            innerReq: { type: 'string' },
            innerOptEnum: { type: 'string', enum: ['x', 'y'] },
            innerOptScalar: { type: 'boolean' },
          },
          required: ['innerReq'],
        },
        // Array optional with object items containing optional properties
        optArray: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemReq: { type: 'string' },
              itemOptEnum: { type: 'string', enum: ['first', 'second'] },
            },
            required: ['itemReq'],
          },
        },
        // oneOf optional
        optOneOf: {
          oneOf: [
            { type: 'string' },
            { type: 'integer' },
          ],
        },
      },
      required: ['reqScalar'],
    },
  }]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)
  const root = asRecord(schema)
  const decisionProp = asRecord(asRecord(root.properties).decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const argsSchema = asRecord(asRecord(toolVariant.properties).arguments)

  assertOptionalPropertiesPermitNull(tools[0].parameters, argsSchema, 'arguments')
})

test('optional property declared with array type gains null on the wire and round-trips correctly', () => {
  const tools: ToolSchema[] = [{
    name: 'multi_type_tool',
    description: 'Tool with union array type property',
    parameters: {
      type: 'object',
      properties: {
        reqField: { type: 'string' },
        multiTypeOpt: {
          type: ['string', 'number'],
          description: 'Value that can be string or number',
        },
      },
      required: ['reqField'],
    },
  }]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)
  const root = asRecord(schema)
  const decisionProp = asRecord(asRecord(root.properties).decision)
  const toolVariant = asRecordArray(decisionProp.anyOf)[0]
  const argsSchema = asRecord(asRecord(toolVariant.properties).arguments)
  const argProps = asRecord(argsSchema.properties)

  // Property declared with type: ['string', 'number'] and absent from required gains 'null'
  const multiTypeProp = asRecord(argProps.multiTypeOpt)
  assert.deepEqual(multiTypeProp.type, ['string', 'number', 'null'])
  assert.equal(argsSchema.required !== undefined && (argsSchema.required as string[]).includes('multiTypeOpt'), true)

  // When model sends null for it, the inverse walk deletes the key
  const nullDecision = codexDecision(
    JSON.stringify({
      decision: {
        kind: 'tool_call',
        name: 'multi_type_tool',
        arguments: {
          reqField: 'required-value',
          multiTypeOpt: null,
        },
      },
    }),
    tools,
  )
  assert.equal(nullDecision.kind, 'tool_call')
  if (nullDecision.kind === 'tool_call') {
    assert.equal(nullDecision.arguments.reqField, 'required-value')
    assert.equal('multiTypeOpt' in nullDecision.arguments, false)
  }

  // When model sends a valid string, it is preserved
  const strDecision = codexDecision(
    JSON.stringify({
      decision: {
        kind: 'tool_call',
        name: 'multi_type_tool',
        arguments: {
          reqField: 'required-value',
          multiTypeOpt: 'hello',
        },
      },
    }),
    tools,
  )
  assert.equal(strDecision.kind, 'tool_call')
  if (strDecision.kind === 'tool_call') {
    assert.equal(strDecision.arguments.multiTypeOpt, 'hello')
  }

  // When model sends a valid number, it is preserved
  const numDecision = codexDecision(
    JSON.stringify({
      decision: {
        kind: 'tool_call',
        name: 'multi_type_tool',
        arguments: {
          reqField: 'required-value',
          multiTypeOpt: 42,
        },
      },
    }),
    tools,
  )
  assert.equal(numDecision.kind, 'tool_call')
  if (numDecision.kind === 'tool_call') {
    assert.equal(numDecision.arguments.multiTypeOpt, 42)
  }
})

test('tool without description produces a variant with no description key at all', () => {
  const tools: ToolSchema[] = [
    {
      name: 'tool_without_desc',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'tool_with_empty_desc',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  ]

  const schema = codexOutputSchema(tools)
  assert.notEqual(schema, undefined)
  const root = asRecord(schema)
  const decisionProp = asRecord(asRecord(root.properties).decision)
  const variants = asRecordArray(decisionProp.anyOf)

  // Tool variant with undefined description has no description key at all (not undefined)
  const noDescVariant = variants[0]
  assert.equal('description' in noDescVariant, false)
  assert.equal(Object.prototype.hasOwnProperty.call(noDescVariant, 'description'), false)
  assert.equal(Object.keys(noDescVariant).includes('description'), false)

  // Tool variant with empty string description has no description key at all
  const emptyDescVariant = variants[1]
  assert.equal('description' in emptyDescVariant, false)
  assert.equal(Object.prototype.hasOwnProperty.call(emptyDescVariant, 'description'), false)
  assert.equal(Object.keys(emptyDescVariant).includes('description'), false)
})
