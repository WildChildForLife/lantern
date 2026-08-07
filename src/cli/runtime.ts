import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { SessionAllowlistRepository } from "../server/core/claude-code/infrastructure/SessionAllowlistRepository.ts";
import {
  type CliOptions,
  LanternOptionsService,
  type StoredOptions,
} from "../server/core/platform/services/LanternOptionsService.ts";
import { ProjectMetaService } from "../server/core/project/services/ProjectMetaService.ts";
import { SessionRepository } from "../server/core/session/infrastructure/SessionRepository.ts";
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
  );

export type BoardData = {
  topics: TopicGroup[];
  conversations: ConversationListEntry[];
  /** How many conversations exist, which may be more than were loaded. */
  total: number;
  /** Source ids Lantern can drive a turn on. The rest are read-only. */
  interactiveSources: string[];
  /** Resolved path of the `claude` binary, when one was configured. */
  executable: string | undefined;
};

const loadBoardData = Effect.gen(function* () {
  const sessionRepository = yield* SessionRepository;
  const registry = yield* SourceRegistry;
  const optionsService = yield* LanternOptionsService;

  const { topics } = yield* sessionRepository.getConversationTopics();
  const { conversations, total } = yield* sessionRepository.getAllConversations({
    limit: MAX_CONVERSATIONS,
  });

  return {
    topics: [...topics],
    conversations: [...conversations],
    total,
    interactiveSources: registry.all
      .filter((adapter) => adapter.capabilities.interactive)
      .map((adapter) => adapter.id),
    executable: yield* optionsService.getOption("executable"),
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
  options: CliOptions,
  stored: StoredOptions,
  onSyncing?: () => void,
): Promise<BoardData> => {
  const program = Effect.gen(function* () {
    const first = yield* loadBoardData;
    if (first.total > 0) {
      return first;
    }

    onSyncing?.();
    const syncService = yield* SyncService;
    yield* syncService.fullSync();

    return yield* loadBoardData;
  });

  return Effect.runPromise(
    program.pipe(
      Effect.provide(readOnlyLayer(options, stored)),
      Effect.scoped,
      // Quiet by default: the board owns the screen, and Effect's pretty logger
      // would draw over it.
      withServerLogLevel(options.verbose),
      Effect.provide(serverLoggerLayer),
    ),
  );
};

/** Re-reads conversations from disk, for the board's refresh key. */
export const resyncBoard = (options: CliOptions, stored: StoredOptions): Promise<BoardData> => {
  const program = Effect.gen(function* () {
    const syncService = yield* SyncService;
    yield* syncService.fullSync();

    return yield* loadBoardData;
  });

  return Effect.runPromise(
    program.pipe(
      Effect.provide(readOnlyLayer(options, stored)),
      Effect.scoped,
      withServerLogLevel(options.verbose),
      Effect.provide(serverLoggerLayer),
    ),
  );
};
