import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { SessionAllowlistRepository } from "../server/core/claude-code/infrastructure/SessionAllowlistRepository.ts";
import { resolveClaudeCodePath } from "../server/core/claude-code/models/ClaudeCode.ts";
import {
  type CliOptions,
  LanternOptionsService,
  type StoredOptions,
} from "../server/core/platform/services/LanternOptionsService.ts";
import { ProjectMetaService } from "../server/core/project/services/ProjectMetaService.ts";
import { SessionRepository } from "../server/core/session/infrastructure/SessionRepository.ts";
import type { ClassifyResult } from "../server/core/session/schema.ts";
import { SessionLocatorService } from "../server/core/session/services/SessionLocatorService.ts";
import { SessionMetaService } from "../server/core/session/services/SessionMetaService.ts";
import { TopicClassifierService } from "../server/core/session/services/TopicClassifierService.ts";
import { SourceConfigBaseDir } from "../server/core/source/config.ts";
import { SourceConfigService } from "../server/core/source/services/SourceConfigService.ts";
import { SourceRegistry } from "../server/core/source/services/SourceRegistry.ts";
import { SyncService } from "../server/core/sync/services/SyncService.ts";
import type { ConversationListEntry, TopicGroup } from "../server/core/types.ts";
import { DrizzleService } from "../server/lib/db/DrizzleService.ts";
import { serverLoggerLayer, withServerLogLevel } from "../server/logging.ts";
import { cliPlatformLayer } from "./platformLayer.ts";

/**
 * More than the web board's 200: a terminal is where somebody goes looking for
 * an old conversation, and paging is worse there than a slightly longer read.
 */
const MAX_CONVERSATIONS = 500;

/**
 * The layers a read-only command needs, and no more.
 *
 * This is the subset of `startServer`'s graph that answers questions about
 * conversations: the platform, the cache, the source adapters and the two
 * repositories. Nothing that listens, watches, schedules or serves is built,
 * so `lantern browse` starts without opening a port or touching a session
 * process.
 */
const InfraBasics = Layer.mergeAll(
  ProjectMetaService.Live,
  SessionMetaService.Live,
  SessionAllowlistRepository.Live,
).pipe(
  Layer.provideMerge(SyncService.Live),
  Layer.provideMerge(SourceRegistry.Live),
  Layer.provideMerge(SourceConfigService.Live),
  Layer.provideMerge(SourceConfigBaseDir.Live),
  Layer.provideMerge(DrizzleService.Live),
);

const readOnlyLayer = (options: CliOptions, stored: StoredOptions) =>
  Layer.mergeAll(
    SessionRepository.Live.pipe(Layer.provideMerge(SessionLocatorService.Live)),
    TopicClassifierService.Live,
  ).pipe(
    Layer.provideMerge(InfraBasics),
    Layer.provideMerge(Layer.mergeAll(cliPlatformLayer(options, stored), NodeContext.layer)),
    // Quiet by default: the board owns the screen, and Effect's pretty logger
    // would draw over it.
    Layer.provideMerge(serverLoggerLayer),
  );

/**
 * The services a command uses, built once and kept for as long as it runs.
 *
 * Built once rather than per call because the cache is a real SQLite connection:
 * a graph rebuilt on every re-read would open one, run the migrator, and hand
 * back a handle nothing closes, so a long session on the board would accumulate
 * a connection per keypress of `r`.
 *
 * `dispose` releases them. Every command that makes one is responsible for it.
 */
export const makeCliRuntime = (options: CliOptions, stored: StoredOptions) =>
  ManagedRuntime.make(readOnlyLayer(options, stored));

export type CliRuntime = ReturnType<typeof makeCliRuntime>;

/** Runs one operation on a command's runtime, at the log level it asked for. */
const run = <A, E>(
  runtime: CliRuntime,
  verbose: boolean | undefined,
  effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Context<CliRuntime>>,
): Promise<A> => runtime.runPromise(effect.pipe(withServerLogLevel(verbose)));

export type BoardData = {
  topics: TopicGroup[];
  conversations: ConversationListEntry[];
  /** How many conversations exist, which may be more than were loaded. */
  total: number;
  /**
   * How many have no topic at all.
   *
   * Shown in the header so the sort key is worth pressing before it is pressed:
   * a pass over nothing costs a CLI call to find that out.
   */
  unclassified: number;
  /** Source ids Lantern can drive a turn on. The rest are read-only. */
  interactiveSources: string[];
  /** Resolved path of the `claude` binary, when one was configured. */
  executable: string | undefined;
};

const loadBoardData = Effect.gen(function* () {
  const sessionRepository = yield* SessionRepository;
  const registry = yield* SourceRegistry;
  const optionsService = yield* LanternOptionsService;
  const topicClassifier = yield* TopicClassifierService;

  const { topics } = yield* sessionRepository.getConversationTopics();
  const { conversations, total } = yield* sessionRepository.getAllConversations({
    limit: MAX_CONVERSATIONS,
  });

  return {
    topics: [...topics],
    conversations: [...conversations],
    total,
    unclassified: yield* topicClassifier.countUnclassified(),
    interactiveSources: registry.all
      .filter((adapter) => adapter.capabilities.interactive)
      .map((adapter) => adapter.id),
    // The absolute path, not the bare name. A window is opened by a shell that
    // reads no profile, so `claude` alone is not on its PATH — which is what
    // "claude: not found" in a fresh window means.
    executable: yield* resolveClaudeCodePath.pipe(
      Effect.catchAll(() => optionsService.getOption("executable")),
    ),
  };
});

/**
 * Loads everything the board draws, syncing first when the cache has nothing.
 *
 * `getAllConversations` reads the cache and only the cache, so a first run —
 * or a run after `~/.lantern` was deleted — would otherwise show an empty
 * board on a machine full of conversations.
 */
export const loadBoard = (
  runtime: CliRuntime,
  verbose: boolean | undefined,
  onSyncing?: () => void,
): Promise<BoardData> =>
  run(
    runtime,
    verbose,
    Effect.gen(function* () {
      const first = yield* loadBoardData;
      if (first.total > 0) {
        return first;
      }

      onSyncing?.();
      const syncService = yield* SyncService;
      yield* syncService.fullSync();

      return yield* loadBoardData;
    }),
  );

/** Re-reads conversations from disk, for the board's refresh key. */
export const resyncBoard = (
  runtime: CliRuntime,
  verbose: boolean | undefined,
): Promise<BoardData> =>
  run(
    runtime,
    verbose,
    Effect.gen(function* () {
      const syncService = yield* SyncService;
      yield* syncService.fullSync();

      return yield* loadBoardData;
    }),
  );

/**
 * Sorts conversations into topics with the configured agent CLI.
 *
 * The same service the web app's buttons go through, called directly rather than
 * over HTTP — the board has the layer graph already, and starting a server to
 * ask a question of the local database would be the long way round.
 *
 * A `selection` scope has no meaning here: the board sorts what has no topic, or
 * everything, and there is no multi-select to draw from.
 */
export const classifyBoard = (
  runtime: CliRuntime,
  verbose: boolean | undefined,
  scope: "unclassified" | "all",
): Promise<ClassifyResult> =>
  run(
    runtime,
    verbose,
    Effect.gen(function* () {
      const topicClassifier = yield* TopicClassifierService;

      return yield* topicClassifier.classify({ scope: { kind: scope } });
    }),
  );
