import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as T3ProjectFileLoader from "../../project/T3ProjectFileLoader.ts";
import { makeProviderRegistryLayer } from "../../provider/testUtils/providerRegistryMock.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { BranchNamingReactor } from "../Services/BranchNamingReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { BranchNamingReactorLive } from "./BranchNamingReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const REQUEST_ID = CommandId.make("cmd-rename");
const TEMPORARY_BRANCH = "t3code/12345678";
const WORKTREE_PATH = "/repo/.worktrees/thread-1";
const NOW = "2026-01-01T00:00:00.000Z";

function makeTestLayer(input: {
  readonly prepareBranchRename: GitWorkflowService.GitWorkflowService["Service"]["prepareBranchRename"];
  readonly applyPreparedBranchRename: GitWorkflowService.GitWorkflowService["Service"]["applyPreparedBranchRename"];
  readonly generateBranchName?: TextGeneration["Service"]["generateBranchName"];
}) {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
  );
  const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
  );

  return BranchNamingReactorLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(projectionSnapshotLayer),
    Layer.provideMerge(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        prepareBranchRename: input.prepareBranchRename,
        applyPreparedBranchRename: input.applyPreparedBranchRename,
        invalidateLocalStatus: () => Effect.void,
        localStatus: () => Effect.die("localStatus should not be needed"),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(TextGeneration)({
        generateBranchName:
          input.generateBranchName ?? (() => Effect.die("generation should not be needed")),
      }),
    ),
    Layer.provideMerge(makeProviderRegistryLayer()),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-branch-naming-reactor-test-" }),
    ),
    Layer.provideMerge(
      Layer.mock(T3ProjectFileLoader.T3ProjectFileLoader)({
        load: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(VcsStatusBroadcaster)({
        refreshStatus: () => Effect.succeed({} as never),
        streamStatus: () => Stream.empty,
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const seedThread = Effect.fn("BranchNamingReactor.test.seedThread")(function* () {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("cmd-project-create"),
    projectId: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/repo",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    createdAt: NOW,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("cmd-thread-create"),
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: TEMPORARY_BRANCH,
    worktreePath: WORKTREE_PATH,
    createdAt: NOW,
  });
});

it.effect("recovers requested branch renames and completes the durable workflow", () => {
  const prepareBranchRename = vi.fn(() => Effect.succeed({ branch: "feature/recovered" }));
  const applyPreparedBranchRename = vi.fn(() => Effect.succeed({ branch: "feature/recovered" }));

  return Effect.scoped(
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const reactor = yield* BranchNamingReactor;
      yield* seedThread();
      yield* engine.dispatch({
        type: "thread.branch.rename",
        commandId: REQUEST_ID,
        threadId: THREAD_ID,
        branch: "feature/recovered",
        expectedBranch: TEMPORARY_BRANCH,
      });

      yield* reactor.start();
      yield* reactor.drain;

      const thread = yield* snapshotQuery.getThreadDetailById(THREAD_ID);
      expect(Option.getOrThrow(thread).branch).toBe("feature/recovered");
      expect(Option.getOrThrow(thread).branchRename).toBeNull();
      expect(prepareBranchRename).toHaveBeenCalledWith({
        cwd: WORKTREE_PATH,
        desiredBranch: "feature/recovered",
      });
      expect(applyPreparedBranchRename).toHaveBeenCalledWith({
        cwd: WORKTREE_PATH,
        previousBranch: TEMPORARY_BRANCH,
        targetBranch: "feature/recovered",
      });
    }),
  ).pipe(Effect.provide(makeTestLayer({ prepareBranchRename, applyPreparedBranchRename })));
});

it.effect("replays a prepared target after restart instead of generating a new one", () => {
  const prepareBranchRename = vi.fn(() => Effect.die("target was already prepared"));
  const applyPreparedBranchRename = vi.fn(() => Effect.succeed({ branch: "feature/recovered-1" }));

  return Effect.scoped(
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const reactor = yield* BranchNamingReactor;
      yield* seedThread();
      yield* engine.dispatch({
        type: "thread.branch.rename",
        commandId: REQUEST_ID,
        threadId: THREAD_ID,
        branch: "feature/recovered",
        expectedBranch: TEMPORARY_BRANCH,
      });
      yield* engine.dispatch({
        type: "thread.branch.rename.prepare",
        commandId: CommandId.make("cmd-prepare"),
        threadId: THREAD_ID,
        requestId: REQUEST_ID,
        targetBranch: "feature/recovered-1",
      });

      yield* reactor.start();
      yield* reactor.drain;

      const thread = yield* snapshotQuery.getThreadDetailById(THREAD_ID);
      expect(Option.getOrThrow(thread).branch).toBe("feature/recovered-1");
      expect(Option.getOrThrow(thread).branchRename).toBeNull();
      expect(prepareBranchRename).not.toHaveBeenCalled();
      expect(applyPreparedBranchRename).toHaveBeenCalledWith({
        cwd: WORKTREE_PATH,
        previousBranch: TEMPORARY_BRANCH,
        targetBranch: "feature/recovered-1",
      });
    }),
  ).pipe(Effect.provide(makeTestLayer({ prepareBranchRename, applyPreparedBranchRename })));
});

it.effect("automatically names a temporary branch from the first user message", () => {
  const generateBranchName = vi.fn(() => Effect.succeed({ branch: "fix-login-crash" }));
  const prepareBranchRename = vi.fn(() => Effect.succeed({ branch: "t3code/fix-login-crash" }));
  const applyPreparedBranchRename = vi.fn(() =>
    Effect.succeed({ branch: "t3code/fix-login-crash" }),
  );

  return Effect.scoped(
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const reactor = yield* BranchNamingReactor;
      yield* seedThread();
      yield* reactor.start();
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-first-turn"),
        threadId: THREAD_ID,
        message: {
          messageId: MessageId.make("message-first-turn"),
          role: "user",
          text: "Fix the login crash",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: NOW,
      });
      yield* Effect.yieldNow;
      yield* reactor.drain;

      const thread = yield* snapshotQuery.getThreadDetailById(THREAD_ID);
      expect(Option.getOrThrow(thread).branch).toBe("t3code/fix-login-crash");
      expect(Option.getOrThrow(thread).branchRename).toBeNull();
      expect(generateBranchName).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: WORKTREE_PATH,
          message: "USER:\nFix the login crash",
        }),
      );
      expect(prepareBranchRename).toHaveBeenCalledWith({
        cwd: WORKTREE_PATH,
        desiredBranch: "t3code/fix-login-crash",
      });
    }),
  ).pipe(
    Effect.provide(
      makeTestLayer({ generateBranchName, prepareBranchRename, applyPreparedBranchRename }),
    ),
  );
});
