import * as Schema from "effect/Schema";

/**
 * Prefixes the branch-naming model may choose from in "conventional" mode.
 * The model's pick is advisory: name assembly validates against this list
 * and falls back to "feature" for anything off-list.
 */
export const CONVENTIONAL_BRANCH_PREFIXES = [
  "feature",
  "bugfix",
  "hotfix",
  "release",
  "chore",
] as const;
export const ConventionalBranchPrefix = Schema.Literals([...CONVENTIONAL_BRANCH_PREFIXES]);
export type ConventionalBranchPrefix = typeof ConventionalBranchPrefix.Type;

/**
 * A custom branch prefix: exactly one lowercase git path segment. The "/"
 * separating prefix from slug is added at name-assembly time, never stored.
 */
export const BranchNamingPrefix = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(32),
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/),
);
export type BranchNamingPrefix = typeof BranchNamingPrefix.Type;

/**
 * How generated worktree branch names are assembled.
 *
 * - "prefix": `<prefix>/<slug>`, with an absent prefix meaning the built-in
 *   default ("t3code").
 * - "conventional": the branch-naming model also picks one of
 *   {@link CONVENTIONAL_BRANCH_PREFIXES} based on the task.
 * - "none": the slug alone, no prefix segment.
 *
 * Temporary branches are always minted as `t3code/<hex>` regardless of this
 * config — it applies only when the model generates the real name (or the
 * user asks for a regeneration).
 */
export const BranchNamingConfig = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("prefix"),
    prefix: Schema.optional(BranchNamingPrefix),
  }),
  Schema.Struct({ mode: Schema.Literal("conventional") }),
  Schema.Struct({ mode: Schema.Literal("none") }),
]);
export type BranchNamingConfig = typeof BranchNamingConfig.Type;

export const DEFAULT_BRANCH_NAMING: BranchNamingConfig = { mode: "prefix" };
