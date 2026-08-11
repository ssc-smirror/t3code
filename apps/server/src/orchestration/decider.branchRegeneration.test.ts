import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

const makeReadModel = (thread?: {
  branch?: string | null;
  branchRegeneration?: { requestId: string; startedAt: string } | null;
}): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: thread?.branch ?? "t3code/abcd1234",
      worktreePath: "/tmp/worktrees/project/t3code-abcd1234",
      latestTurn: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      ...(thread?.branchRegeneration !== undefined
        ? {
            branchRegeneration:
              thread.branchRegeneration === null
                ? null
                : {
                    requestId: CommandId.make(thread.branchRegeneration.requestId),
                    startedAt: thread.branchRegeneration.startedAt,
                  },
          }
        : {}),
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: UPDATED_AT,
});

it.layer(NodeServices.layer)("branch regeneration decider", (it) => {
  it.effect("marks a pending regeneration with the previous branch", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-branch-regeneration-request"),
          threadId: ThreadId.make("thread-1"),
          regenerateBranch: true,
        },
        readModel: makeReadModel(),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload).toMatchObject({
          threadId: ThreadId.make("thread-1"),
          regenerateBranch: true,
          previousBranch: "t3code/abcd1234",
          branchRegeneration: {
            requestId: CommandId.make("cmd-branch-regeneration-request"),
          },
        });
      }
    }),
  );

  it.effect("clears a pending regeneration when the branch is set manually", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-manual-branch"),
          threadId: ThreadId.make("thread-1"),
          branch: "feature/manual",
        },
        readModel: makeReadModel({
          branchRegeneration: { requestId: "cmd-pending-request", startedAt: UPDATED_AT },
        }),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload).toMatchObject({
          branch: "feature/manual",
          branchRegeneration: null,
        });
      }
    }),
  );

  it.effect("applies a completion for the current request", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.regeneration.complete",
          commandId: CommandId.make("cmd-regeneration-complete"),
          threadId: ThreadId.make("thread-1"),
          requestId: CommandId.make("cmd-pending-request"),
          branch: "t3code/fix-login-crash",
        },
        readModel: makeReadModel({
          branchRegeneration: { requestId: "cmd-pending-request", startedAt: UPDATED_AT },
        }),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload).toMatchObject({
          branch: "t3code/fix-login-crash",
          branchRegeneration: null,
        });
      }
    }),
  );

  it.effect("preserves updatedAt and the branch for a stale completion", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.regeneration.complete",
          commandId: CommandId.make("cmd-regeneration-complete"),
          threadId: ThreadId.make("thread-1"),
          requestId: CommandId.make("cmd-old-request"),
          branch: "t3code/fix-login-crash",
        },
        readModel: makeReadModel({
          branchRegeneration: { requestId: "cmd-newer-request", startedAt: UPDATED_AT },
        }),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        expect(event.payload).toEqual({
          threadId: ThreadId.make("thread-1"),
          updatedAt: UPDATED_AT,
        });
      }
    }),
  );

  it.effect("respects the expectedBranch guard for concurrent manual updates", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-rename-follow-up"),
          threadId: ThreadId.make("thread-1"),
          branch: "feature/renamed",
          expectedBranch: "t3code/stale-name",
        },
        readModel: makeReadModel({ branch: "t3code/abcd1234" }),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type === "thread.meta-updated") {
        // The expected branch no longer matches, so the current one is kept.
        expect((event.payload as { branch?: unknown }).branch).toBe("t3code/abcd1234");
      }
    }),
  );
});
