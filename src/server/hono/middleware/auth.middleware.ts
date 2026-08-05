import { randomBytes, timingSafeEqual } from "node:crypto";
import { Context, Effect, Layer, Runtime } from "effect";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { LanternOptionsService } from "../../core/platform/services/LanternOptionsService.ts";
import type { InferEffect } from "../../lib/effect/types.ts";
import type { HonoContext } from "../app.ts";

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Returns false immediately if lengths differ (length is already leaked by nature).
 */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
};

// Generate a cryptographically random session token (not derived from password)
const generateSessionToken = (password: string | undefined): string => {
  if (password === undefined || password === "") return "";
  return randomBytes(32).toString("hex");
};

const getBearerToken = (authorization: string | undefined) => {
  if (authorization === undefined || authorization === "") return undefined;
  const [scheme, token] = authorization.split(" ");
  if (scheme === undefined || scheme === "" || token === undefined || token === "")
    return undefined;
  if (scheme.toLowerCase() !== "bearer") return undefined;
  const trimmedToken = token.trim();
  return trimmedToken.length > 0 ? trimmedToken : undefined;
};

const createAuthRequiredMiddleware = (
  authEnabled: boolean,
  validSessionToken: string,
  authPassword: string | undefined,
) => {
  return createMiddleware<HonoContext>(async (c, next) => {
    // Skip auth for non-API routes (let frontend handle auth state)
    if (!c.req.path.startsWith("/api")) {
      return next();
    }

    // Skip auth check if authentication is not enabled
    if (!authEnabled) {
      return next();
    }

    const sessionToken = getCookie(c, "lantern-session");
    const bearerToken = getBearerToken(c.req.header("Authorization"));
    const cookieAuthorized =
      sessionToken !== undefined &&
      validSessionToken !== "" &&
      safeEqual(sessionToken, validSessionToken);
    const bearerAuthorized =
      authPassword !== undefined &&
      bearerToken !== undefined &&
      safeEqual(bearerToken, authPassword);

    if (!cookieAuthorized && !bearerAuthorized) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  });
};

const LayerImpl = Effect.gen(function* () {
  const optionsService = yield* LanternOptionsService;
  const runtime = yield* Effect.runtime<LanternOptionsService>();
  const runPromise = Runtime.runPromise(runtime);

  // Cache the session token so it remains stable across calls (generated once on first access)
  let cachedSessionToken: string | undefined;

  const getAuthState = Effect.gen(function* () {
    const authPassword = yield* optionsService.getOption("password");
    const authEnabled = authPassword !== undefined;
    cachedSessionToken ??= generateSessionToken(authPassword);
    return { authEnabled, authPassword, validSessionToken: cachedSessionToken };
  });

  const authRequiredMiddleware = createMiddleware<HonoContext>(async (c, next) => {
    if (!c.req.path.startsWith("/api")) {
      return next();
    }

    const { authEnabled, validSessionToken, authPassword } = await runPromise(getAuthState);

    return createAuthRequiredMiddleware(authEnabled, validSessionToken, authPassword)(c, next);
  });

  return {
    getAuthState,
    authRequiredMiddleware,
  };
});

export type IAuthMiddleware = InferEffect<typeof LayerImpl>;
export class AuthMiddleware extends Context.Tag("AuthMiddleware")<
  AuthMiddleware,
  IAuthMiddleware
>() {
  static Live = Layer.effect(this, LayerImpl);
}
