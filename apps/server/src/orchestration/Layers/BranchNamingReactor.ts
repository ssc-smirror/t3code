import {
  CommandId,
  type ChatAttachment,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type ProjectId,
  type ThreadBranchRename,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { buildGeneratedWorktreeBranchName, isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import * as T3ProjectFileLoader from "../../project/T3ProjectFileLoader.ts";
import { resolveBranchNamingSettings } from "../../project/BranchNamingSettings.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../../serverSettings.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import {
  BranchNamingReactor,
  type BranchNamingReactorShape,
} from "../Services/BranchNamingReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const MAX_CONTEXT_CHARS = 8_000;
const MAX_ATTACHMENTS = 4;

type BranchNamingWork =
  | { readonly kind: "auto"; readonly threadId: ThreadId }
  | { readonly kind: "rename"; readonly threadId: ThreadId; readonly requestId: CommandId };

function formatBranchNamingContext(messages: ReadonlyArray<OrchestrationMessage>): {
  readonly message: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const sections = messages.flatMap((message) => {
    if (message.role === "system") return [];
    const text = message.text.trim();
    const attachmentNames = (message.attachments ?? []).map((attachment) => attachment.name);
    const contents = [text, ...attachmentNames.map((name) => `[Attachment: ${name}]`)]
      .filter((value) => value.length > 0)
      .join("\n");
    return contents.length === 0 ? [] : [`${message.role.toUpperCase()}:\n${contents}`];
  });
  const fullContext = sections.join("\n\n");
  const attachments = messages
    .flatMap((message) => message.attachments ?? [])
    .slice(-MAX_ATTACHMENTS);
  return {
    message:
      fullContext.length <= MAX_CONTEXT_CHARS
        ? fullContext
        : `[Earlier content truncated]\n\n${fullContext.slice(-MAX_CONTEXT_CHARS)}`,
    attachments,
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const textGeneration = yield* TextGeneration;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const projectFileLoader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;

  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });
  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    return yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
  });
  const dispatchAbort = Effect.fn("BranchNamingReactor.dispatchAbort")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly observedBranch?: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.branch.rename.abort",
      commandId: yield* serverCommandId("branch-rename-abort"),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(input.observedBranch === undefined ? {} : { observedBranch: input.observedBranch }),
    });
  });
  const dispatchComplete = Effect.fn("BranchNamingReactor.dispatchComplete")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly branch: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.branch.rename.complete",
      commandId: yield* serverCommandId("branch-rename-complete"),
      threadId: input.threadId,
      requestId: input.requestId,
      branch: input.branch,
    });
  });

  const resolveSettings = Effect.fn("BranchNamingReactor.resolveSettings")(function* (
    projectId: ProjectId,
  ) {
    const global = yield* serverSettings.getSettings;
    const project = yield* resolveProject(projectId);
    const projectFile =
      project === undefined ? Option.none() : yield* projectFileLoader.load(project.workspaceRoot);
    return {
      project,
      global,
      resolved: resolveBranchNamingSettings({
        ...(project === undefined ? {} : { project }),
        ...(Option.isNone(projectFile) ? {} : { projectFile: projectFile.value }),
        global,
      }),
    };
  });

  const requestAutomaticName = Effect.fn("BranchNamingReactor.requestAutomaticName")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* resolveThread(threadId);
    if (
      thread === undefined ||
      thread.branch === null ||
      thread.worktreePath === null ||
      thread.branchRename != null ||
      !isTemporaryWorktreeBranch(thread.branch) ||
      thread.messages.filter((message) => message.role === "user").length !== 1
    ) {
      return;
    }
    const { resolved } = yield* resolveSettings(thread.projectId);
    if (!resolved.autoGenerate) return;

    yield* orchestrationEngine.dispatch({
      type: "thread.branch.regenerate",
      commandId: yield* serverCommandId("automatic-branch-name"),
      threadId,
      expectedBranch: thread.branch,
    });
  });

  const prepareRequestedRename = Effect.fn("BranchNamingReactor.prepareRequestedRename")(function* (
    threadId: ThreadId,
    pending: Extract<ThreadBranchRename, { status: "requested" }>,
  ) {
    const thread = yield* resolveThread(threadId);
    if (thread?.branchRename?.requestId !== pending.requestId) return;

    let desiredBranch = pending.kind === "rename" ? pending.requestedBranch : undefined;
    if (pending.kind === "generate") {
      const context = formatBranchNamingContext(thread.messages);
      if (context.message.length === 0) {
        yield* dispatchAbort({ threadId, requestId: pending.requestId });
        return;
      }
      const { global, resolved } = yield* resolveSettings(thread.projectId);
      const modelSelection =
        global.sourceControlWriterModelSelection === null
          ? global.textGenerationModelSelection
          : resolveSourceControlWriterModelSelection(global, yield* providerRegistry.getProviders);
      const generated = yield* textGeneration.generateBranchName({
        cwd: pending.worktreePath,
        message: context.message,
        ...(context.attachments.length === 0 ? {} : { attachments: context.attachments }),
        ...(resolved.naming.mode === "conventional" ? { conventional: true } : {}),
        modelSelection,
      });
      desiredBranch = buildGeneratedWorktreeBranchName(generated.branch, resolved.naming);
    }
    if (desiredBranch === undefined || desiredBranch === pending.previousBranch) {
      yield* dispatchAbort({ threadId, requestId: pending.requestId });
      return;
    }

    const prepared = yield* gitWorkflow.prepareBranchRename({
      cwd: pending.worktreePath,
      desiredBranch,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.branch.rename.prepare",
      commandId: yield* serverCommandId("branch-rename-prepare"),
      threadId,
      requestId: pending.requestId,
      targetBranch: prepared.branch,
    });
  });

  const applyPreparedRename = Effect.fn("BranchNamingReactor.applyPreparedRename")(function* (
    threadId: ThreadId,
    pending: Extract<ThreadBranchRename, { status: "prepared" }>,
  ) {
    const thread = yield* resolveThread(threadId);
    if (thread?.branchRename?.requestId !== pending.requestId) return;

    const result = yield* gitWorkflow.applyPreparedBranchRename({
      cwd: pending.worktreePath,
      previousBranch: pending.previousBranch,
      targetBranch: pending.targetBranch,
    });
    yield* dispatchComplete({ threadId, requestId: pending.requestId, branch: result.branch });
    yield* vcsStatusBroadcaster
      .refreshStatus(pending.worktreePath)
      .pipe(Effect.ignoreCause({ log: true }));
  });

  const processRename = Effect.fn("BranchNamingReactor.processRename")(function* (
    threadId: ThreadId,
    requestId: CommandId,
  ) {
    const thread = yield* resolveThread(threadId);
    const pending = thread?.branchRename;
    if (pending == null || pending.requestId !== requestId) return;
    if (pending.status === "requested") {
      yield* prepareRequestedRename(threadId, pending);
    } else {
      yield* applyPreparedRename(threadId, pending);
    }
  });

  const reconcileFailedRename = Effect.fn("BranchNamingReactor.reconcileFailedRename")(function* (
    work: Extract<BranchNamingWork, { kind: "rename" }>,
  ) {
    const thread = yield* resolveThread(work.threadId);
    const pending = thread?.branchRename;
    if (pending == null || pending.requestId !== work.requestId) return;
    if (pending.status === "requested") {
      yield* dispatchAbort({ threadId: work.threadId, requestId: work.requestId });
      return;
    }

    yield* gitWorkflow.invalidateLocalStatus(pending.worktreePath);
    const status = yield* gitWorkflow.localStatus({ cwd: pending.worktreePath });
    if (status.refName === pending.targetBranch) {
      yield* dispatchComplete({
        threadId: work.threadId,
        requestId: work.requestId,
        branch: pending.targetBranch,
      });
      return;
    }
    yield* dispatchAbort({
      threadId: work.threadId,
      requestId: work.requestId,
      ...(status.refName === null ? {} : { observedBranch: status.refName }),
    });
  });

  const processWorkSafely = Effect.fn("BranchNamingReactor.processWorkSafely")(
    function* (work: BranchNamingWork) {
      if (work.kind === "auto") {
        yield* requestAutomaticName(work.threadId);
      } else {
        yield* processRename(work.threadId, work.requestId);
      }
    },
    (effect, work) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          const log = Effect.logWarning("branch naming reactor failed to process work", {
            threadId: work.threadId,
            workKind: work.kind,
            cause: Cause.pretty(cause),
          });
          return work.kind === "auto" ? log : log.pipe(Effect.andThen(reconcileFailedRename(work)));
        }),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("branch naming reactor could not reconcile failed work", {
                threadId: work.threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );
  const worker = yield* makeDrainableWorker(processWorkSafely);

  const start: BranchNamingReactorShape["start"] = Effect.fn("BranchNamingReactor.start")(
    function* () {
      const processEvent = Effect.fn("BranchNamingReactor.processEvent")(function* (
        event: OrchestrationEvent,
      ) {
        if (event.type === "thread.turn-start-requested") {
          yield* worker.enqueue({ kind: "auto", threadId: event.payload.threadId });
        } else if (event.type === "thread.meta-updated" && event.payload.branchRename != null) {
          yield* worker.enqueue({
            kind: "rename",
            threadId: event.payload.threadId,
            requestId: event.payload.branchRename.requestId,
          });
        }
      });
      yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));

      const recoverPending = Effect.gen(function* () {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        yield* Effect.forEach(
          readModel.threads,
          (thread) =>
            thread.branchRename == null
              ? Effect.void
              : worker.enqueue({
                  kind: "rename",
                  threadId: thread.id,
                  requestId: thread.branchRename.requestId,
                }),
          { discard: true },
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("branch naming reactor failed to recover pending work", {
                cause: Cause.pretty(cause),
              }),
        ),
      );
      const activation = yield* ServerActivation;
      if (activation === undefined) {
        yield* recoverPending;
      } else {
        yield* forkParked(recoverPending);
      }
    },
  );

  return { start, drain: worker.drain } satisfies BranchNamingReactorShape;
});

export const BranchNamingReactorLive = Layer.effect(BranchNamingReactor, make);
