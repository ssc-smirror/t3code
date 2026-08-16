import * as Schema from "effect/Schema";

/**
 * A custom branch prefix: exactly one lowercase git ref component. Beyond the
 * charset, `git check-ref-format` forbids ".." anywhere and a ".lock" suffix
 * in a component. The "/" separating prefix from slug is added at
 * name-assembly time, never stored. This pattern is the single validator —
 * settings UIs import it rather than repeating the rules.
 */
export const BRANCH_NAMING_PREFIX_PATTERN =
  /^(?!.*\.\.)(?!.*\.lock$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export const BranchNamingPrefix = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(32),
  Schema.isPattern(BRANCH_NAMING_PREFIX_PATTERN),
);
export type BranchNamingPrefix = typeof BranchNamingPrefix.Type;

/**
 * How generated worktree branch names are assembled.
 *
 * - "prefix": `<prefix>/<slug>`, with an absent prefix meaning the built-in
 *   default ("t3code").
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
  Schema.Struct({ mode: Schema.Literal("none") }),
]);
export type BranchNamingConfig = typeof BranchNamingConfig.Type;

export const DEFAULT_BRANCH_NAMING: BranchNamingConfig = { mode: "prefix" };
