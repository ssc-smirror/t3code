import { describe, expect, it } from "vite-plus/test";

import { resolveBranchNamingSettings } from "./BranchNamingSettings.ts";

const global = {
  branchNaming: { mode: "prefix", prefix: "global" } as const,
  autoGenerateBranchNames: true,
};

describe("resolveBranchNamingSettings", () => {
  it("uses project settings before t3.json and global settings", () => {
    expect(
      resolveBranchNamingSettings({
        project: { branchNaming: { mode: "none" }, autoGenerateBranchName: false },
        projectFile: { branchNaming: { mode: "prefix", prefix: "repo" } },
        global,
      }),
    ).toEqual({ naming: { mode: "none" }, autoGenerate: false });
  });

  it("uses t3.json before the global branch naming setting", () => {
    expect(
      resolveBranchNamingSettings({
        project: { branchNaming: null, autoGenerateBranchName: null },
        projectFile: { branchNaming: { mode: "prefix", prefix: "repo" } },
        global,
      }),
    ).toEqual({ naming: { mode: "prefix", prefix: "repo" }, autoGenerate: true });
  });

  it("falls back to global settings", () => {
    expect(resolveBranchNamingSettings({ global })).toEqual({
      naming: { mode: "prefix", prefix: "global" },
      autoGenerate: true,
    });
  });
});
