import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { AgentSessionRepository } from "../../agent-session/infrastructure/AgentSessionRepository.ts";
import { EventBus } from "../../events/services/EventBus.ts";
import { SessionRepository } from "../../session/infrastructure/SessionRepository.ts";
import { generateSessionHtml } from "../services/ExportService.ts";
import { SessionLocatorService } from "../services/SessionLocatorService.ts";

const LayerImpl = Effect.gen(function* () {
  const sessionRepository = yield* SessionRepository;
  const agentSessionRepository = yield* AgentSessionRepository;
  const sessionLocatorService = yield* SessionLocatorService;
  const fs = yield* FileSystem.FileSystem;
  const eventBus = yield* EventBus;

  const getSession = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      const { session } = yield* sessionRepository.getSession(projectId, sessionId);

      return {
        status: 200,
        response: { session },
      } as const satisfies ControllerResponse;
    });

  const exportSessionHtml = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      const { session } = yield* sessionRepository.getSession(projectId, sessionId);

      if (session === null) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      const html = yield* generateSessionHtml(session, projectId, agentSessionRepository);

      return {
        status: 200,
        response: { html },
      } as const satisfies ControllerResponse;
    });

  const deleteSession = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      // The ids come from the URL and the result is passed to fs.remove, so the
      // locator re-checks the path against the directories Lantern reads.
      const location = yield* sessionLocatorService.locate(projectId, sessionId).pipe(
        // A cached path the locator refuses is corruption or tampering rather
        // than a missing session. Both answer 404, but this one must not pass
        // unrecorded.
        Effect.tapError((error) =>
          error._tag === "UnsafeSessionPathError"
            ? Effect.logWarning(
                `Refused a session whose cached path failed validation (${error.reason}): ${error.filePath}`,
              )
            : Effect.void,
        ),
        Effect.catchAll(() => Effect.succeed(null)),
      );

      if (location === null) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      // Lantern only ever reads another CLI's history.
      if (!location.deletable) {
        return {
          status: 403,
          response: { error: `Lantern does not delete ${location.sourceId} sessions` },
        } as const satisfies ControllerResponse;
      }

      const sessionPath = location.filePath;

      const exists = yield* fs.exists(sessionPath);
      if (!exists) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      // Delete the session file
      const deleteResult = yield* fs.remove(sessionPath).pipe(
        Effect.map(() => ({ success: true, error: null }) as const),
        Effect.catchAll((error) =>
          Effect.succeed({
            success: false,
            error: `Failed to delete session: ${error.message}`,
          } as const),
        ),
      );

      if (!deleteResult.success) {
        return {
          status: 500,
          response: { error: deleteResult.error },
        } as const satisfies ControllerResponse;
      }

      // Emit sessionListChanged event to notify clients
      yield* eventBus.emit("sessionListChanged", { projectId });

      return {
        status: 200,
        response: { success: true },
      } as const satisfies ControllerResponse;
    });

  const listConversationTopics = () =>
    Effect.gen(function* () {
      const result = yield* sessionRepository.getConversationTopics();

      return {
        status: 200,
        response: result,
      } as const satisfies ControllerResponse;
    });

  const listAllConversations = (options: {
    limit?: number;
    offset?: number;
    query?: string;
    topic?: string;
  }) =>
    Effect.gen(function* () {
      const result = yield* sessionRepository.getAllConversations(options);

      return {
        status: 200,
        response: result,
      } as const satisfies ControllerResponse;
    });

  return {
    getSession,
    exportSessionHtml,
    deleteSession,
    listAllConversations,
    listConversationTopics,
  };
});

export type ISessionController = InferEffect<typeof LayerImpl>;
export class SessionController extends Context.Tag("SessionController")<
  SessionController,
  ISessionController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
