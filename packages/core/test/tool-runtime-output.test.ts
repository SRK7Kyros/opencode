import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import type { Tool } from "@opencode/schema/tool"
import { execute } from "@opencode/core/tool/runtime"
import { it } from "./lib/effect"

// A declared output schema whose Encoded form may be `undefined` — the shape produced by a
// conditional / optional schema. Reproduces the Code Mode crash where `encodeOutput` yielded
// `undefined`, `Effect` dropped it, and Code Mode's per-call wrapper died on `"output" in result`
// with the unhelpful "a is not an Object".
const MaybeOutput = Schema.UndefinedOr(Schema.String)

const context = {
  sessionID: "ses_test",
  messageID: "msg_test",
  agent: "test",
  abort: new AbortController().signal,
  callID: "call_test",
} as unknown as Tool.Context

const makeTool = (output: unknown) =>
  ({
    description: "test tool",
    input: Schema.Struct({}),
    output: MaybeOutput,
    execute: () => Effect.succeed({ output, content: [] }),
  }) as unknown as Tool.Info<any, any>

// A tool that declares NO output and whose execute returns a bare value. This is the shape a
// legacy/plugin tool produces after the promise adapter wraps it in `Effect.tryPromise`, so the
// Effect success value is a primitive rather than a `{ content, metadata }` envelope.
const makeBareTool = (declared: unknown, result: unknown) =>
  ({
    description: "bare test tool",
    input: Schema.Struct({}),
    output: declared,
    execute: () => Effect.succeed(result),
  }) as unknown as Tool.Info<any, any>

describe("tool runtime output encoding", () => {
  it.live("keeps the output key present when a declared output encodes to undefined", () =>
    Effect.gen(function* () {
      const result = yield* execute(makeTool(undefined), {}, context)
      // The key must survive so callers can inspect it; a bare `undefined` success value is
      // dropped by Effect, leaving a consumer that does `"output" in result` nothing to inspect.
      expect("output" in result).toBe(true)
      expect(result.output).toBeNull()
    }),
  )

  it.live("passes a defined output through unchanged", () =>
    Effect.gen(function* () {
      const result = yield* execute(makeTool("hello"), {}, context)
      expect(result.output).toBe("hello")
    }),
  )

  it.live("surfaces a bare value from a tool that declares no output", () =>
    Effect.gen(function* () {
      // Before the guard this threw `"a is not an Object"` on `"output" in <string>`.
      const result = yield* execute(makeBareTool(undefined, "Found 3 file(s)"), {}, context)
      expect("output" in result).toBe(true)
      expect(result.output).toBeUndefined()
      expect(result.content).toEqual([{ type: "text", text: "Found 3 file(s)" }])
    }),
  )

  it.live("reports a missing declared output instead of crashing on a bare value", () =>
    Effect.gen(function* () {
      const failure = yield* execute(makeBareTool(MaybeOutput, "hello"), {}, context).pipe(Effect.flip)
      expect(failure.message).toBe("Tool did not return its declared output")
    }),
  )

  it.live("stringifies a bare object from a tool that declares no output", () =>
    Effect.gen(function* () {
      // A legacy value is not the runtime envelope, so it becomes text — the empty `content`
      // lookup used to render the literal `undefined` instead.
      const result = yield* execute(makeBareTool(undefined, { hello: "world" }), {}, context)
      expect(result.output).toBeUndefined()
      expect(result.content).toEqual([{ type: "text", text: '{"hello":"world"}' }])
    }),
  )

  it.live("prefers the output field of a v1 result when a tool declares no output", () =>
    Effect.gen(function* () {
      const result = yield* execute(
        makeBareTool(undefined, { title: "T", output: "real text", metadata: { n: 1 } }),
        {},
        context,
      )
      expect(result.content).toEqual([{ type: "text", text: "real text" }])
    }),
  )

  it.live("keeps a declared-output result that carries no content", () =>
    Effect.gen(function* () {
      // MCP tools return `{ output }` without `content`, so the envelope check must not reject them.
      const tool = {
        description: "mcp-style tool",
        input: Schema.Struct({}),
        output: Schema.String,
        execute: () => Effect.succeed({ output: "value" }),
      } as unknown as Tool.Info<any, any>
      const result = yield* execute(tool, {}, context)
      expect(result.output).toBe("value")
    }),
  )
})
