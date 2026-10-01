import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Promise tool executors receive interruption through their AbortSignal", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const started = yield* Deferred.make<AbortSignal>()
    yield* PluginPromise.fromPromise({
      id: "cancel-tool",
      async setup(context) {
        await context.tool.transform((editor) =>
          editor.add({
            name: "wait",
            description: "Wait until cancelled",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false },
            execute: (_input, context) =>
              new Promise<never>((_resolve, reject) => {
                context.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
                Effect.runSync(Deferred.succeed(started, context.signal))
              }),
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    const fiber = yield* snapshot
      .execute({
        sessionID: Session.ID.make("ses_promise_tool_cancel"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_promise_tool_cancel"),
        call: { type: "tool-call", id: "call_promise_tool_cancel", name: "wait", input: {} },
      })
      .pipe(Effect.forkScoped)
    const signal = yield* Deferred.await(started)
    expect(signal.aborted).toBe(false)
    yield* Fiber.interrupt(fiber)
    const exit = yield* Fiber.await(fiber)
    expect(signal.aborted).toBe(true)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  }),
)

// v1 plugin tools reach permissions through `ToolContext.ask` (see @opencode-ai/plugin
// tool.d.ts). The v2 bridge must supply it, delegating to the host permission service, and a
// bare string result must still reach the model as content instead of crashing the runtime.
it.live("Promise tool executors receive a working ToolContext.ask", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    yield* PluginPromise.fromPromise({
      id: "ask-tool",
      async setup(context) {
        await context.tool.transform((editor) =>
          editor.add({
            name: "gate",
            description: "Request permission before returning",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false },
            execute: (async (_input: unknown, context: any) => {
              await context.ask({
                permission: "gate",
                patterns: ["target"],
                always: ["target"],
                metadata: { reason: "test" },
              })
              return "granted"
            }) as never,
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    const result = yield* snapshot.execute({
      sessionID: Session.ID.make("ses_promise_tool_ask"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_promise_tool_ask"),
      call: { type: "tool-call", id: "call_promise_tool_ask", name: "gate", input: {} },
    })
    expect(result.content).toEqual([{ type: "text", text: "granted" }])
  }),
)

// A legacy plugin tool's result is a raw value, not the runtime's `{ output, content, metadata }`
// envelope. Code Mode must still see it as usable content: an object was previously flattened to
// the literal `undefined`, which made object-returning plugin tools look empty.
it.live("Promise tool results reach Code Mode as text for non-string values", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    yield* PluginPromise.fromPromise({
      id: "legacy-shape-tool",
      async setup(context) {
        await context.tool.transform((editor) => {
          editor.add({
            name: "object_tool",
            description: "Return an object",
            input: { type: "object", properties: {}, additionalProperties: false },
            execute: (async () => ({ hello: "world" })) as never,
          })
          editor.add({
            name: "result_tool",
            description: "Return a v1 result",
            input: { type: "object", properties: {}, additionalProperties: false },
            execute: (async () => ({ title: "T", output: "real text" })) as never,
          })
        })
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    const run = (code: string) =>
      snapshot.execute({
        sessionID: Session.ID.make("ses_promise_tool_shapes"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_promise_tool_shapes"),
        call: { type: "tool-call", id: "call_promise_tool_shapes", name: "execute", input: { code } },
      })
    const object = yield* run("return await tools.object_tool({})")
    expect(object.output?.output).toContain("hello")
    expect(object.output?.output).toContain("world")
    const result = yield* run("return await tools.result_tool({})")
    expect(result.output?.output).toContain("real text")
  }),
)
