import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import {
  classifyQuerySchema,
  classifySelectionBodySchema,
  scopeFromQuery,
} from "../../core/session/functions/classifyScope.ts";
import { SessionController } from "../../core/session/presentation/SessionController.ts";
import { TopicClassifierService } from "../../core/session/services/TopicClassifierService.ts";
import { effectToResponse } from "../../lib/effect/toEffectResponse.ts";
import type { HonoContext } from "../app.ts";
import { getHonoRuntime } from "../runtime.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  query: z.string().optional(),
  topic: z.string().optional(),
});

const conversationRoutes = Effect.gen(function* () {
  const sessionController = yield* SessionController;
  const topicClassifier = yield* TopicClassifierService;
  const runtime = yield* getHonoRuntime;

  return (
    new Hono<HonoContext>()
      .get("/topics", async (c) => {
        const response = await effectToResponse(
          c,
          sessionController.listConversationTopics().pipe(Effect.provide(runtime)),
        );
        return response;
      })
      // How many conversations have no topic at all. The field is still called
      // `pending` because that is what the header button counts down.
      .get("/topics/pending", async (c) => {
        const response = await effectToResponse(
          c,
          topicClassifier.countUnclassified().pipe(
            Effect.map((pending) => ({ status: 200, response: { pending } }) as const),
            Effect.provide(runtime),
          ),
        );
        return response;
      })
      .post("/topics/classify", zValidator("query", classifyQuerySchema), async (c) => {
        const scope = scopeFromQuery(c.req.valid("query"));
        const response = await effectToResponse(
          c,
          topicClassifier.classify({ scope }).pipe(
            Effect.map((result) => ({ status: 200, response: result }) as const),
            Effect.provide(runtime),
          ),
        );
        return response;
      })
      // A separate route rather than an optional body on the one above: a
      // zValidator("json") rejects a request with no body, and the RPC client
      // makes `json` a required argument wherever it is declared.
      .post(
        "/topics/classify/selection",
        zValidator("json", classifySelectionBodySchema),
        async (c) => {
          const { sessionIds } = c.req.valid("json");
          const response = await effectToResponse(
            c,
            topicClassifier.classify({ scope: { kind: "selection", sessionIds } }).pipe(
              Effect.map((result) => ({ status: 200, response: result }) as const),
              Effect.provide(runtime),
            ),
          );
          return response;
        },
      )
      .get("/", zValidator("query", listQuerySchema), async (c) => {
        const response = await effectToResponse(
          c,
          sessionController
            .listAllConversations(c.req.valid("query"))
            .pipe(Effect.provide(runtime)),
        );
        return response;
      })
  );
});

export { conversationRoutes };
