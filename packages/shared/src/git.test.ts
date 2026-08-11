import type { VcsStatusRemoteResult, VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyGitStatusStreamEvent,
  buildGeneratedWorktreeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  WORKTREE_BRANCH_PREFIX,
} from "./git.ts";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:T3Tools/T3Code.git")).toBe(
      "github.com/t3tools/t3code",
    );
    expect(normalizeGitRemoteUrl("https://github.com/T3Tools/T3Code.git")).toBe(
      "github.com/t3tools/t3code",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/T3Tools/T3Code")).toBe(
      "github.com/t3tools/t3code",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:T3Tools/platform/T3Code.git")).toBe(
      "gitlab.com/t3tools/platform/t3code",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/T3Tools/platform/T3Code.git")).toBe(
      "gitlab.com/t3tools/platform/t3code",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("git@github.com:T3Tools/T3Code.git"),
    ).toBe("T3Tools/T3Code");
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("https://github.com/T3Tools/T3Code.git"),
    ).toBe("T3Tools/T3Code");
  });
});

describe("isTemporaryWorktreeBranch", () => {
  it("matches the generated temporary worktree refName format", () => {
    expect(
      isTemporaryWorktreeBranch(
        buildTemporaryWorktreeBranchName((byteLength) => {
          expect(byteLength).toBe(4);
          return "DEADBEEF";
        }),
      ),
    ).toBe(true);
  });

  it("matches generated temporary worktree refs", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/deadbeef `)).toBe(true);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/DEADBEEF`)).toBe(true);
  });

  it("normalizes a UUID-shaped random callback to the canonical 8-hex form", () => {
    expect(buildTemporaryWorktreeBranchName(() => "f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12")).toBe(
      `${WORKTREE_BRANCH_PREFIX}/f4ae4e0e`,
    );
  });

  it("matches legacy UUID-shaped temporary worktree refs from older mobile builds", () => {
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-b4f2-9cf0aa54ab12`),
    ).toBe(true);
  });

  it("rejects UUID-shaped refs that are not RFC 4122 v4", () => {
    // version nibble is not 4
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-1d48-b4f2-9cf0aa54ab12`),
    ).toBe(false);
    // variant nibble is not [89ab]
    expect(
      isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/f4ae4e0e-f971-4d48-c4f2-9cf0aa54ab12`),
    ).toBe(false);
  });

  it("rejects non-temporary refName names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("main")).toBe(false);
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef-extra`)).toBe(false);
  });
});

describe("buildGeneratedWorktreeBranchName", () => {
  it("prefixes with the default worktree prefix in prefix mode", () => {
    expect(
      buildGeneratedWorktreeBranchName({ branch: "Fix Login Crash" }, { mode: "prefix" }),
    ).toBe("t3code/fix-login-crash");
  });

  it("uses a custom prefix and strips a duplicated prefix from the slug", () => {
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "acme/fix-login-crash" },
        { mode: "prefix", prefix: "acme" },
      ),
    ).toBe("acme/fix-login-crash");
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "t3code/fix-login-crash" },
        { mode: "prefix", prefix: "acme" },
      ),
    ).toBe("acme/fix-login-crash");
  });

  it("strips refs/heads/ and quotes before assembling", () => {
    expect(
      buildGeneratedWorktreeBranchName({ branch: 'refs/heads/"fix-thing"' }, { mode: "prefix" }),
    ).toBe("t3code/fix-thing");
  });

  it("keeps a valid conventional prefix picked by the model", () => {
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "handle-empty-cart", prefix: "bugfix" },
        { mode: "conventional" },
      ),
    ).toBe("bugfix/handle-empty-cart");
  });

  it("falls back to a conventional prefix embedded in the slug", () => {
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "chore/bump-deps", prefix: "housekeeping" },
        { mode: "conventional" },
      ),
    ).toBe("chore/bump-deps");
  });

  it("falls back to feature for off-list conventional prefixes", () => {
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "add-dark-mode", prefix: "feat" },
        { mode: "conventional" },
      ),
    ).toBe("feature/add-dark-mode");
    expect(
      buildGeneratedWorktreeBranchName({ branch: "add-dark-mode" }, { mode: "conventional" }),
    ).toBe("feature/add-dark-mode");
  });

  it("does not repeat the prefix when the model echoes it in the slug", () => {
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "bugfix/handle-empty-cart", prefix: "bugfix" },
        { mode: "conventional" },
      ),
    ).toBe("bugfix/handle-empty-cart");
  });

  it("produces a bare slug in none mode", () => {
    expect(buildGeneratedWorktreeBranchName({ branch: "Fix Login Crash" }, { mode: "none" })).toBe(
      "fix-login-crash",
    );
    expect(
      buildGeneratedWorktreeBranchName({ branch: "t3code/fix-login-crash" }, { mode: "none" }),
    ).toBe("fix-login-crash");
  });

  it("falls back to update for empty slugs", () => {
    expect(buildGeneratedWorktreeBranchName({ branch: "  " }, { mode: "prefix" })).toBe(
      "t3code/update",
    );
    expect(
      buildGeneratedWorktreeBranchName(
        { branch: "bugfix", prefix: "bugfix" },
        { mode: "conventional" },
      ),
    ).toBe("bugfix/update");
  });

  it("truncates overlong slugs to 64 characters", () => {
    const generated = buildGeneratedWorktreeBranchName(
      { branch: "x".repeat(200) },
      { mode: "prefix" },
    );
    expect(generated).toBe(`t3code/${"x".repeat(64)}`);
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: VcsStatusResult = {
      isRepo: true,
      sourceControlProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: VcsStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
