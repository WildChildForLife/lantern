import { Command } from "@effect/platform";
import { desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessionTopics, sessions } from "../../../lib/db/schema.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { resolveClaudeCodePath } from "../../claude-code/models/ClaudeCode.ts";
import {
  buildClassificationPrompt,
  type ClassificationCandidate,
  cliEnvelopeSchema,
  parseClassificationResponse,
} from "../functions/buildClassificationPrompt.ts";
import {
  buildConversationListItem,
  firstUserMessageText,
  isInternalSession,
} from "../functions/buildConversationListItem.ts";
import { normalizeTopicIcon } from "../functions/groupConversationsByTopic.ts";

/**
 * Files conversations under a topic by asking Claude Code itself, headlessly.
 *
 * It runs the same CLI the user already signed in to (`claude -p`), so there is
 * no API key to configure and no separate bill. Results are cached per session
 * in the `session_topics` table: a conversation is classified once, and again
 * only if its title changes, which keeps repeat passes nearly free.
 */

/** Conversations per CLI call. Large enough to be cheap, small enough to stay accurate. */
const BATCH_SIZE = 40;

/** Batches per pass, so one run cannot spend the afternoon classifying. */
const MAX_BATCHES_PER_RUN = 6;

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

const CLI_TIMEOUT_MS = 180_000;

/** Topics offered back to the classifier for reuse, most used first. */
const EXISTING_TOPIC_LIMIT = 40;

export type ClassifyResult = {
  classified: number;
  remaining: number;
  batches: number;
  /** What this pass drew from the signed-in Claude Code account, in USD. */
  costUsd: number;
  failed: boolean;
};

const LayerImpl = Effect.gen(function* () {
  const { db } = yield* DrizzleService;

  /** Conversations with no topic yet, or whose title changed since they got one. */
  const pendingCandidates = (limit: number): ClassificationCandidate[] => {
    const rows = db
      .select({
        sessionId: sessions.id,
        projectId: sessions.projectId,
        source: sessions.source,
        projectName: projects.name,
        projectPath: projects.path,
        customTitle: sessions.customTitle,
        firstUserMessageJson: sessions.firstUserMessageJson,
        messageCount: sessions.messageCount,
        lastModifiedAt: sessions.lastModifiedAt,
        modelName: sessions.modelName,
        totalCostUsd: sessions.totalCostUsd,
        classifiedText: sessionTopics.sourceText,
      })
      .from(sessions)
      .innerJoin(projects, eq(sessions.projectId, projects.id))
      .leftJoin(sessionTopics, eq(sessionTopics.sessionId, sessions.id))
      .orderBy(desc(sessions.lastModifiedAt))
      .all();

    return rows
      .filter((row) => !isInternalSession(buildConversationListItem(row)))
      .map((row) => {
        const item = buildConversationListItem(row);
        const text = item.title ?? firstUserMessageText(item).slice(0, 160);
        return {
          sessionId: item.sessionId,
          text: text.trim(),
          projectPath: item.projectPath,
          classifiedText: row.classifiedText,
        };
      })
      .filter((candidate) => candidate.text !== "")
      .filter((candidate) => candidate.classifiedText !== candidate.text)
      .slice(0, limit)
      .map(({ sessionId, text, projectPath }) => ({ sessionId, text, projectPath }));
  };

  const existingTopics = (): string[] =>
    db
      .select({ label: sessionTopics.label, uses: sql<number>`count(*)` })
      .from(sessionTopics)
      .groupBy(sessionTopics.label)
      .orderBy(sql`count(*) desc`)
      .all()
      .slice(0, EXISTING_TOPIC_LIMIT)
      .map((row) => row.label);

  const runClassifier = (prompt: string) =>
    Effect.gen(function* () {
      const claudePath = yield* resolveClaudeCodePath;

      const output = yield* Command.string(
        Command.make(
          claudePath,
          "-p",
          prompt,
          "--model",
          CLASSIFIER_MODEL,
          "--output-format",
          "json",
        ),
      ).pipe(Effect.timeout(CLI_TIMEOUT_MS));

      // Older CLIs, or a crash mid-stream, can answer without the envelope.
      const envelope = cliEnvelopeSchema.safeParse(JSON.parse(output));
      return envelope.success
        ? { text: envelope.data.result, costUsd: envelope.data.total_cost_usd ?? 0 }
        : { text: output, costUsd: 0 };
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

  /**
   * Classifies everything still pending, in batches. Batches run one after the
   * other on purpose: they share a topic vocabulary, so a later batch can reuse
   * the names an earlier one settled on.
   */
  const classifyPending = (options?: { maxBatches?: number; force?: boolean }) =>
    Effect.gen(function* () {
      const maxBatches = options?.maxBatches ?? MAX_BATCHES_PER_RUN;

      // A forced pass throws the cached topics away, which is what you want
      // after changing how topics are named.
      if (options?.force === true) {
        db.delete(sessionTopics).run();
      }

      let classified = 0;
      let batches = 0;
      let costUsd = 0;
      let failed = false;

      // Candidates are read once and sliced into batches. Re-querying between
      // batches looked cleaner but spun: a conversation still being written to
      // never stops being pending, so every round re-picked it and burned a
      // call on the same title.
      const candidates = pendingCandidates(BATCH_SIZE * maxBatches);

      for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
        const batch = candidates.slice(offset, offset + BATCH_SIZE);
        if (batch.length === 0) break;

        const prompt = buildClassificationPrompt(batch, existingTopics());
        const response = yield* runClassifier(prompt).pipe(
          Effect.catchAll((error) =>
            Effect.logError(`[TopicClassifier] CLI failed: ${String(error)}`).pipe(Effect.as(null)),
          ),
        );

        if (response === null) {
          failed = true;
          break;
        }

        const stored = storeBatch(batch, response.text, Date.now());
        batches += 1;
        classified += stored;
        costUsd += response.costUsd;

        // An unusable answer means the next batch would likely fail the same
        // way; stopping keeps a broken run cheap.
        if (stored === 0) {
          failed = true;
          break;
        }
      }

      return {
        classified,
        remaining: pendingCandidates(Number.MAX_SAFE_INTEGER).length,
        batches,
        costUsd,
        failed,
      } satisfies ClassifyResult;
    });

  const countPending = () => Effect.sync(() => pendingCandidates(Number.MAX_SAFE_INTEGER).length);

  return { classifyPending, countPending };
});

export type ITopicClassifierService = InferEffect<typeof LayerImpl>;

export class TopicClassifierService extends Context.Tag("TopicClassifierService")<
  TopicClassifierService,
  ITopicClassifierService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
