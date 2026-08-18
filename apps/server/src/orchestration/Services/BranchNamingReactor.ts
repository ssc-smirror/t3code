/**
 * BranchNamingReactor - durable generated/manual worktree branch renames.
 *
 * Callers persist intent through orchestration commands. The reactor owns
 * name generation, collision resolution, Git mutation, and restart recovery.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface BranchNamingReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class BranchNamingReactor extends Context.Service<
  BranchNamingReactor,
  BranchNamingReactorShape
>()("t3/orchestration/Services/BranchNamingReactor") {}
