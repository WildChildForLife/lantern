import { HttpClient } from "@effect/platform";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect } from "effect";
import { z } from "zod";
import packageJson from "../../../package.json" with { type: "json" };

const REGISTRY_URL = `https://registry.npmjs.org/${packageJson.name}/latest`;

/**
 * Plain JSON, and only the `latest` tag.
 *
 * The whole packument lists every version ever published and grows with the
 * project; this endpoint is the one release manifest. It is also the reason the
 * `Accept` header is unremarkable — asking this URL for npm's abbreviated
 * packument type comes back 406, and an empty body reads as "no answer".
 */
const ACCEPT = "application/json";

const responseSchema = z.object({ version: z.string() });

/** Kept apart from the request so the shape can be tested without a network. */
export const parseLatestVersionResponse = (raw: unknown): string | null => {
  const parsed = responseSchema.safeParse(raw);

  return parsed.success ? parsed.data.version : null;
};

/**
 * Asks npm what the newest published version is, or gives up quietly.
 *
 * Every failure is the same answer — null. A registry that is down, a machine
 * with no route out, a proxy that swallows the request: none of them are
 * problems the user asked Lantern to report, and a CLI that complains about the
 * network on startup is worse than one that says nothing.
 *
 * Note that undici only honours HTTPS_PROXY when it is handed a ProxyAgent, so
 * behind a corporate proxy this times out and stays silent, by design.
 */
export const fetchLatestVersion = (): Promise<string | null> =>
  Effect.runPromise(
    HttpClient.get(REGISTRY_URL, { headers: { accept: ACCEPT } }).pipe(
      Effect.flatMap((response) =>
        // A registry error, a captive portal, a proxy's own page: anything but
        // a 2xx is not an answer, and its body is not worth reading.
        response.status >= 200 && response.status < 300
          ? response.json
          : Effect.succeed<unknown>(null),
      ),
      Effect.map(parseLatestVersionResponse),
      Effect.timeout("5 seconds"),
      Effect.catchAll(() => Effect.succeed(null)),
      Effect.provide(NodeHttpClient.layerUndici),
      Effect.scoped,
    ),
  );
