import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type ThreadBranchRename,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const THREAD_ID = ThreadId.make("thread-1");
const REQUEST_ID = CommandId.make("cmd-rename");
const UPDATED_AT = "2026-01-01T00:00:00.000Z";

function readModel(branchRename: ThreadBranchRename | null = null): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "t3code/12345678",
        worktreePath: "/repo/.worktrees/thread-1",
        branchRename,
        latestTurn: null,
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: UPDATED_AT,
  };
}

const requested: ThreadBranchRename = {
  status: "requested",
  requestId: REQUEST_ID,
  kind: "rename",
  previousBranch: "t3code/12345678",
  requestedBranch: "feature/rename-me",
  worktreePath: "/repo/.worktrees/thread-1",
  startedAt: UPDATED_AT,
};

const prepared: ThreadBranchRename = {
  status: "prepared",
  requestId: REQUEST_ID,
  kind: "rename",
  previousBranch: "t3code/12345678",
  targetBranch: "feature/rename-me-1",
  worktreePath: "/repo/.worktrees/thread-1",
  startedAt: UPDATED_AT,
};

it.layer(NodeServices.layer)("branch rename decider", (it) => {
  it.effect("persists rename intent before any Git work", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.rename",
          commandId: REQUEST_ID,
          threadId: THREAD_ID,
          branch: "feature/rename-me",
          expectedBranch: "t3code/12345678",
        },
        readModel: readModel(),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type !== "thread.meta-updated") return;
      expect(event.payload.branchRename).toMatchObject({
        status: "requested",
        requestId: REQUEST_ID,
        kind: "rename",
        previousBranch: "t3code/12345678",
        requestedBranch: "feature/rename-me",
        worktreePath: "/repo/.worktrees/thread-1",
      });
    }),
  );

  it.effect("persists the collision-resolved target before applying it", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.rename.prepare",
          commandId: CommandId.make("cmd-prepare"),
          threadId: THREAD_ID,
          requestId: REQUEST_ID,
          targetBranch: "feature/rename-me-1",
        },
        readModel: readModel(requested),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type !== "thread.meta-updated") return;
      expect(event.payload.branchRename).toEqual(prepared);
      expect(event.payload.branch).toBeUndefined();
    }),
  );

  it.effect("commits metadata only for the prepared target", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.rename.complete",
          commandId: CommandId.make("cmd-complete"),
          threadId: THREAD_ID,
          requestId: REQUEST_ID,
          branch: "feature/rename-me-1",
        },
        readModel: readModel(prepared),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type !== "thread.meta-updated") return;
      expect(event.payload).toMatchObject({
        threadId: THREAD_ID,
        branch: "feature/rename-me-1",
        branchRename: null,
      });
    }),
  );

  it.effect("rejects a second rename and direct branch metadata changes while pending", () =>
    Effect.gen(function* () {
      const secondRename = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.regenerate",
          commandId: CommandId.make("cmd-second-rename"),
          threadId: THREAD_ID,
          expectedBranch: "t3code/12345678",
        },
        readModel: readModel(requested),
      }).pipe(Effect.flip);
      const metadataChange = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-metadata-change"),
          threadId: THREAD_ID,
          branch: "feature/bypass",
        },
        readModel: readModel(requested),
      }).pipe(Effect.flip);

      expect(secondRename._tag).toBe("OrchestrationCommandInvariantError");
      expect(metadataChange._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("reconciles metadata to the branch observed after a failed Git operation", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.branch.rename.abort",
          commandId: CommandId.make("cmd-abort"),
          threadId: THREAD_ID,
          requestId: REQUEST_ID,
          observedBranch: "feature/externally-renamed",
        },
        readModel: readModel(prepared),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.meta-updated");
      if (event.type !== "thread.meta-updated") return;
      expect(event.payload).toMatchObject({
        threadId: THREAD_ID,
        branch: "feature/externally-renamed",
        branchRename: null,
      });
    }),
  );
});
