import { CommandId, EventId, ProjectId, type OrchestrationEvent } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-branch-naming");

const seedProjectCreated = (sequence: number): OrchestrationEvent => ({
  sequence,
  eventId: EventId.make(`evt-project-branch-naming-${sequence}`),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "project.created",
  occurredAt: now,
  commandId: CommandId.make(`cmd-project-branch-naming-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`cmd-project-branch-naming-${sequence}`),
  metadata: {},
  payload: {
    projectId,
    title: "Branch naming",
    workspaceRoot: "/tmp/branch-naming",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
});

it.layer(NodeServices.layer)("decider project branchNaming", (it) => {
  it.effect("propagates branchNaming through meta.update into the read model", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));
      expect(readModel.projects[0]?.branchNaming).toBeNull();
      expect(readModel.projects[0]?.autoGenerateBranchName).toBeNull();

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-branch-naming-set"),
          projectId,
          branchNaming: { mode: "none" },
          autoGenerateBranchName: false,
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.meta-updated");
      expect((event.payload as { branchNaming?: unknown }).branchNaming).toEqual({
        mode: "none",
      });
      expect((event.payload as { autoGenerateBranchName?: unknown }).autoGenerateBranchName).toBe(
        false,
      );

      const updated = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(updated.projects[0]?.branchNaming).toEqual({ mode: "none" });
      expect(updated.projects[0]?.autoGenerateBranchName).toBe(false);
    }),
  );

  it.effect("omits the fields when unset and clears them on explicit null", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));

      const unrelated = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-branch-naming-title"),
          projectId,
          title: "Renamed",
        },
        readModel,
      });
      const unrelatedEvent = Array.isArray(unrelated) ? unrelated[0] : unrelated;
      expect("branchNaming" in (unrelatedEvent.payload as object)).toBe(false);
      expect("autoGenerateBranchName" in (unrelatedEvent.payload as object)).toBe(false);

      const set = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-branch-naming-set"),
          projectId,
          branchNaming: { mode: "prefix", prefix: "acme" },
          autoGenerateBranchName: true,
        },
        readModel,
      });
      const setEvent = Array.isArray(set) ? set[0] : set;
      const afterSet = yield* projectEvent(readModel, { ...setEvent, sequence: 2 });
      expect(afterSet.projects[0]?.branchNaming).toEqual({ mode: "prefix", prefix: "acme" });

      const clear = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-branch-naming-clear"),
          projectId,
          branchNaming: null,
          autoGenerateBranchName: null,
        },
        readModel: afterSet,
      });
      const clearEvent = Array.isArray(clear) ? clear[0] : clear;
      const afterClear = yield* projectEvent(afterSet, { ...clearEvent, sequence: 3 });
      expect(afterClear.projects[0]?.branchNaming).toBeNull();
      expect(afterClear.projects[0]?.autoGenerateBranchName).toBeNull();
    }),
  );
});
