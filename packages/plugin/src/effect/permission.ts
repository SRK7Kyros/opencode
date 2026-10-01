import type { PermissionApi } from "@opencode/client/effect/api"
import type { Effect } from "effect"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { Hooks } from "./registration.js"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
}

export interface PermissionAssertInput {
  readonly sessionID: Session.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  readonly agent?: Agent.ID
}

export type PermissionDomain = Pick<PermissionApi<unknown>, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
  /**
   * Evaluate the action against the session's rules and, when the outcome is `ask`, prompt the
   * user; the effect fails when the request is denied. Mirrors the core `Permission.assert` used
   * by built-in tools, and is what v1 plugin tools reach through `ToolContext.ask`.
   */
  readonly assert: (input: PermissionAssertInput) => Effect.Effect<void, unknown>
}
