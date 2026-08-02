import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
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

const classifyQuerySchema = z.object({
  force: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const conversationRoutes = Effect.gen(function* () {
  const sessionController = yield* SessionController;
  const topicClassifier = yield* TopicClassifierService;
  const runtime = yield* getHonoRuntime;

  return new Hono<HonoContext>()
    .get("/topics", async (c) => {
      const response = await effectToResponse(
        c,
        sessionController.listConversationTopics().pipe(Effect.provide(runtime)),
      );
      return response;
    })
    .get("/topics/pending", async (c) => {
      const response = await effectToResponse(
        c,
        topicClassifier.countPending().pipe(
          Effect.map((pending) => ({ status: 200, response: { pending } }) as const),
          Effect.provide(runtime),
        ),
      );
      return response;
    })
    .post("/topics/classify", zValidator("query", classifyQuerySchema), async (c) => {
      const { force } = c.req.valid("query");
      const response = await effectToResponse(
        c,
        topicClassifier.classifyPending({ force }).pipe(
          Effect.map((result) => ({ status: 200, response: result }) as const),
          Effect.provide(runtime),
        ),
      );
      return response;
    })
    .get("/", zValidator("query", listQuerySchema), async (c) => {
      const response = await effectToResponse(
        c,
        sessionController.listAllConversations(c.req.valid("query")).pipe(Effect.provide(runtime)),
      );
      return response;
    });
});

export { conversationRoutes };
