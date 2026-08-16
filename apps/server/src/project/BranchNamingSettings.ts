import type {
  BranchNamingConfig,
  OrchestrationProjectShell,
  ServerSettings,
  T3ProjectFile,
} from "@t3tools/contracts";

type ProjectBranchNamingSettings = Pick<
  OrchestrationProjectShell,
  "branchNaming" | "autoGenerateBranchName"
>;

type GlobalBranchNamingSettings = Pick<ServerSettings, "branchNaming" | "autoGenerateBranchNames">;

/** Resolve the server-side settings that govern generated worktree names. */
export function resolveBranchNamingSettings(input: {
  readonly project?: ProjectBranchNamingSettings;
  readonly projectFile?: Pick<T3ProjectFile, "branchNaming">;
  readonly global: GlobalBranchNamingSettings;
}): {
  readonly naming: BranchNamingConfig;
  readonly autoGenerate: boolean;
} {
  return {
    naming:
      input.project?.branchNaming ?? input.projectFile?.branchNaming ?? input.global.branchNaming,
    autoGenerate: input.project?.autoGenerateBranchName ?? input.global.autoGenerateBranchNames,
  };
}
