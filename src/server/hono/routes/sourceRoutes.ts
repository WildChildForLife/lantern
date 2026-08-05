import { zValidator } from "@hono/zod-validator";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { sourceIdSchema } from "../../core/source/models/SourceId.ts";
import { SourceController } from "../../core/source/presentation/SourceController.ts";
import { effectToResponse } from "../../lib/effect/toEffectResponse.ts";
import type { HonoContext } from "../app.ts";
import { getHonoRuntime } from "../runtime.ts";

const setEnabledSchema = z.object({
  enabled: z.array(sourceIdSchema),
});

const sourceRoutes = Effect.gen(function* () {
  const sourceController = yield* SourceController;
  const runtime = yield* getHonoRuntime;

  return new Hono<HonoContext>()
    .get("/", async (c) => {
      const response = await effectToResponse(
        c,
        sourceController.listSources().pipe(Effect.provide(runtime)),
      );

      return response;
    })
    .put("/", zValidator("json", setEnabledSchema), async (c) => {
      const { enabled } = c.req.valid("json");

      const response = await effectToResponse(
        c,
        sourceController.setEnabledSources(enabled).pipe(Effect.provide(runtime)),
      );

      return response;
    });
});

export { sourceRoutes };
