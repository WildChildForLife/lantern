import { Command } from "@effect/platform";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";
import { MAX_CLASSIFY_PER_PASS } from "../../../../lib/topics/classifyLimits.ts";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessionTopics, sessions } from "../../../lib/db/schema.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { UserConfigService } from "../../platform/services/UserConfigService.ts";
import { HeadlessUnavailableError } from "../../source/models/SourceAdapter.ts";
import { CLAUDE_CODE_SOURCE_ID, sourceIdSchema } from "../../source/models/SourceId.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import {
  type ClassificationCandidate,
  parseClassificationResponse,
} from "../functions/buildClassificationPrompt.ts";
import {
  type ClassificationCandidateRow,
  selectPassCandidates,
  toClassificationCandidate,
} from "../functions/classificationCandidates.ts";
import { classifyFailureMessage } from "../functions/classifyFailureMessage.ts";
import type { ClassifyScope } from "../functions/classifyScope.ts";
import { normalizeTopicIcon } from "../functions/groupConversationsByTopic.ts";
import { runClassificationBatches } from "../functions/runClassificationBatches.ts";
import type { ClassifyResult } from "../schema.ts";

/**
 * Files conversations under a topic by asking an agent CLI itself, headlessly.
 *
 * It runs whichever CLI the user chose, using the login they already have, so
 * there is no API key to configure and no separate bill. Results are cached per
 * session in the `session_topics` table.
 *
 * A conversation is classified once and then left alone. Re-classifying one is
 * something the user asks for — by selecting it, or by redoing everything —
 * because it costs a CLI call, and a pass that quietly re-bills conversations
 * it has already filed is a pass nobody can predict the price of.
 *
 * A CLI with no headless mode, or one that is not installed, leaves the local
 * keyword grouping in place rather than failing the request — naming topics is
 * an improvement on that grouping, never a precondition for it.
 */

/** Conversations per CLI call. Large enough to be cheap, small enough to stay accurate. */
const BATCH_SIZE = 40;

/**
 * The sentence to show for a failed call. `HeadlessUnavailableError` carries
 * the useful one — why the CLI could not be resolved — under `reason`, where a
 * plain `String(error)` would print the tag instead.
 */
const describeClassifierError = (error: unknown): string => {
  if (error instanceof HeadlessUnavailableError) return error.reason;

  return error instanceof Error ? error.message : String(error);
};

/**
 * Only Claude Code takes a model flag here. The others are driven by whatever
 * the user configured them with, which is theirs to decide, not Lantern's.
 */
const CLAUDE_CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

const CLI_TIMEOUT_MS = 180_000;

/** Topics offered back to the classifier for reuse, most used first. */
const EXISTING_TOPIC_LIMIT = 40;

const LayerImpl = Effect.gen(function* () {
  const { db } = yield* DrizzleService;
  const registry = yield* SourceRegistry;
  const userConfigService = yield* UserConfigService;

  /**
   * One pass at a time. Passes cost money and a forced one deletes rows, so
   * overlapping them is never what the user meant — two tabs, or the header
   * button and the selection bar, used to be enough to interleave.
   */
  const passLock = yield* Effect.makeSemaphore(1);

  /**
   * The four columns a candidate needs. Selecting a whole list-item row and
   * rebuilding a `ConversationListItem` per session is what made counting
   * candidates cost more as the log grew.
   */
  const candidateColumns = {
    sessionId: sessions.id,
    projectPath: projects.path,
    customTitle: sessions.customTitle,
    firstUserMessageJson: sessions.firstUserMessageJson,
  };

  /**
   * Something to classify at all. Neither column set means no text either way.
   *
   * Deliberately looser than the JS check that follows: an empty-string title
   * passes this and is then dropped. SQL narrowing may only ever admit too much.
   */
  const hasText = or(isNotNull(sessions.customTitle), isNotNull(sessions.firstUserMessageJson));

  /**
   * `leftJoin` on projects because a candidate's `projectPath` is nullable and
   * the join contributes nothing else. A session cannot currently outlive its
   * project — the foreign key cascades — so this only says that a candidate does
   * not depend on one, rather than fixing a reachable case.
   */
  const unclassifiedRows = (): ClassificationCandidateRow[] =>
    db
      .select(candidateColumns)
      .from(sessions)
      .leftJoin(projects, eq(sessions.projectId, projects.id))
      .leftJoin(sessionTopics, eq(sessionTopics.sessionId, sessions.id))
      .where(and(hasText, isNull(sessionTopics.sessionId)))
      // Newest first, so a capped pass takes the ones most worth naming.
      .orderBy(desc(sessions.lastModifiedAt))
      .all();

  /**
   * Exactly the conversations asked for, topic or no topic: re-classifying one
   * that is already filed is the point of picking it out by hand.
   */
  const rowsForSessionIds = (sessionIds: readonly string[]): ClassificationCandidateRow[] =>
    db
      .select(candidateColumns)
      .from(sessions)
      .leftJoin(projects, eq(sessions.projectId, projects.id))
      .where(and(hasText, inArray(sessions.id, [...sessionIds])))
      .orderBy(desc(sessions.lastModifiedAt))
      .all();

  /** Every classifiable conversation, filed or not. Only `all` wants this. */
  const allRows = (): ClassificationCandidateRow[] =>
    db
      .select(candidateColumns)
      .from(sessions)
      .leftJoin(projects, eq(sessions.projectId, projects.id))
      .where(hasText)
      .orderBy(desc(sessions.lastModifiedAt))
      .all();

  /**
   * The narrowing SQL cannot do the whole job: telling the classifier's own runs
   * apart needs the logged message parsed, and a second definition of that in
   * SQL would drift from the one the conversation list uses. So SQL narrows to
   * the rows that could possibly qualify — in steady state, almost none — and
   * the pure predicate finishes over those.
   */
  const countUnclassifiedNow = (): number =>
    unclassifiedRows().filter((row) => toClassificationCandidate(row) !== null).length;

  const existingTopics = (): string[] =>
    db
      .select({ label: sessionTopics.label, uses: sql<number>`count(*)` })
      .from(sessionTopics)
      .groupBy(sessionTopics.label)
      .orderBy(sql`count(*) desc`)
      .all()
      .slice(0, EXISTING_TOPIC_LIMIT)
      .map((row) => row.label);

  /** The CLI the user picked, or Claude Code when they have not picked one. */
  const classifierAdapter = Effect.gen(function* () {
    const config = yield* userConfigService.getUserConfig();
    const parsed = sourceIdSchema.safeParse(config.primarySource);
    const sourceId = parsed.success ? parsed.data : CLAUDE_CODE_SOURCE_ID;

    return registry.get(sourceId);
  });

  /**
   * The CLI, resolved but not yet asked anything. Separate from `runClassifier`
   * so a pass can find out whether it *can* classify before doing something it
   * cannot undo — see the wipe in `classify`.
   */
  const classifierRunner = Effect.gen(function* () {
    const adapter = yield* classifierAdapter;
    const runner = adapter?.headless;
    if (adapter === undefined || runner === undefined) {
      return yield* Effect.fail(new Error("The selected agent CLI cannot be asked to name topics"));
    }

    return { adapter, runner, executable: yield* runner.executable() };
  });

  const runClassifier = (prompt: string) =>
    Effect.gen(function* () {
      const { adapter, runner, executable } = yield* classifierRunner;

      // Which CLI answered is the first thing anyone asks when a topic name
      // looks wrong, and it is not otherwise recoverable from the result.
      yield* Effect.logInfo(`[TopicClassifier] asking ${adapter.id} via ${executable}`);

      // Claude Code is pinned to a cheap model for this; the others run on
      // whatever the user configured, which is not Lantern's to override.
      const args =
        adapter.id === CLAUDE_CODE_SOURCE_ID
          ? [...runner.args(prompt), "--model", CLAUDE_CLASSIFIER_MODEL]
          : [...runner.args(prompt)];

      const output = yield* Command.string(Command.make(executable, ...args)).pipe(
        Effect.timeout(CLI_TIMEOUT_MS),
      );

      return runner.parse(output);
    });

  const storeBatch = (
    candidates: readonly ClassificationCandidate[],
    response: string,
    classifiedAt: number,
  ): number => {
    const parsed = parseClassificationResponse(response);
    if (parsed === null) return 0;

    let stored = 0;
    for (const entry of parsed) {
      const candidate = candidates[entry.n - 1];
      if (candidate === undefined) continue;

      db.insert(sessionTopics)
        .values({
          sessionId: candidate.sessionId,
          label: entry.topic.trim(),
          icon: normalizeTopicIcon(entry.icon.trim()),
          sourceText: candidate.text,
          classifiedAt,
        })
        .onConflictDoUpdate({
          target: sessionTopics.sessionId,
          set: {
            label: entry.topic.trim(),
            icon: normalizeTopicIcon(entry.icon.trim()),
            sourceText: candidate.text,
            classifiedAt,
          },
        })
        .run();
      stored += 1;
    }

    return stored;
  };

  /** The rows a scope resolves to. Reading only — nothing here mutates. */
  const rowsForScope = (scope: ClassifyScope): ClassificationCandidateRow[] => {
    switch (scope.kind) {
      case "all":
        return allRows();
      case "unclassified":
        return unclassifiedRows();
      case "selection":
        return rowsForSessionIds(scope.sessionIds);
      default:
        scope satisfies never;
        return [];
    }
  };

  const storedTopics = () => db.select().from(sessionTopics).all();

  const restoreTopics = (rows: readonly (typeof sessionTopics.$inferSelect)[]): void => {
    if (rows.length === 0) return;
    db.insert(sessionTopics)
      .values([...rows])
      .onConflictDoNothing()
      .run();
  };

  /**
   * A forced pass throws the cached topics away, which is what you want after
   * changing how topics are named — but only once it is known the CLI can
   * answer, and it is put back if the pass turns out to classify nothing.
   *
   * Wiping first and asking afterwards is how "Redo all" with no CLI installed
   * used to lose every topic and file none.
   */
  const wipeForForcedPass = Effect.gen(function* () {
    const usable = yield* classifierRunner.pipe(
      Effect.as(true),
      Effect.catchAll((error) =>
        Effect.logError(`[TopicClassifier] not wiping topics: ${String(error)}`).pipe(
          Effect.as(false),
        ),
      ),
    );
    if (!usable) return null;

    const snapshot = storedTopics();
    db.delete(sessionTopics).run();
    return snapshot;
  });

  /**
   * Classifies what the scope resolves to, in batches, capped per pass. What the
   * cap left over is reported rather than dropped, so a big pass reads as
   * deferred instead of as finished.
   *
   * Passes are serialised. Two at once used to interleave, and a forced one
   * could delete the rows another had already paid for.
   */
  const classify = (options: { scope: ClassifyScope; maxCandidates?: number }) =>
    passLock.withPermits(1)(
      Effect.gen(function* () {
        const max = options.maxCandidates ?? MAX_CLASSIFY_PER_PASS;
        const forced = options.scope.kind === "all";

        /**
         * What the CLI said when it could not answer. Held here rather than
         * returned by `ask`, whose null is all `runClassificationBatches` needs
         * to know — the words are for the user, not for the loop.
         */
        const failureDetail = yield* Ref.make<string | null>(null);

        const snapshot = forced ? yield* wipeForForcedPass : null;
        if (forced && snapshot === null) {
          return {
            classified: 0,
            remaining: countUnclassifiedNow(),
            batches: 0,
            costUsd: 0,
            requested: 0,
            queued: 0,
            failed: true,
            failureReason: classifyFailureMessage("cli-unavailable", null),
          } satisfies ClassifyResult;
        }

        const { queued, requested } = selectPassCandidates(rowsForScope(options.scope), max);

        const outcome = yield* runClassificationBatches(queued, BATCH_SIZE, {
          existingTopics,
          ask: (prompt) =>
            runClassifier(prompt).pipe(
              Effect.catchAll((error) =>
                Effect.logError(`[TopicClassifier] CLI failed: ${String(error)}`).pipe(
                  Effect.zipRight(Ref.set(failureDetail, describeClassifierError(error))),
                  Effect.as(null),
                ),
              ),
            ),
          store: (batch, answer) => storeBatch(batch, answer, Date.now()),
        });

        // A forced pass that filed nothing has thrown away topics and replaced
        // them with nothing. Put them back rather than leave the user empty.
        if (snapshot !== null && outcome.classified === 0) {
          restoreTopics(snapshot);
        }

        return {
          classified: outcome.classified,
          remaining: countUnclassifiedNow(),
          batches: outcome.batches,
          costUsd: outcome.costUsd,
          requested,
          queued: queued.length,
          failed: outcome.failed,
          failureReason: classifyFailureMessage(outcome.failure, yield* Ref.get(failureDetail)),
        } satisfies ClassifyResult;
      }),
    );

  /** How many conversations have no topic at all. Backs the header button. */
  const countUnclassified = () => Effect.sync(countUnclassifiedNow);

  return { classify, countUnclassified };
});

export type ITopicClassifierService = InferEffect<typeof LayerImpl>;

export class TopicClassifierService extends Context.Tag("TopicClassifierService")<
  TopicClassifierService,
  ITopicClassifierService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
