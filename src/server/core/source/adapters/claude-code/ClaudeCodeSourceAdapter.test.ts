import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { testPlatformLayer } from "../../../../../testing/layers/testPlatformLayer.ts";
import { claudeCodeSourceAdapter } from "./ClaudeCodeSourceAdapter.ts";

const testLayer = Layer.mergeAll(testPlatformLayer(), NodeFileSystem.layer);

const ROOT = "/home/someone/.claude/projects";

describe("claudeCodeSourceAdapter.classifyChange", () => {
  it("maps a session file to its project and session", () => {
    expect(
      claudeCodeSourceAdapter.classifyChange(`${ROOT}/-home-someone-repo/abc-123.jsonl`, [ROOT]),
    ).toStrictEqual({
      sourceId: "claude-code",
      projectStoragePath: `${ROOT}/-home-someone-repo`,
      sessionId: "abc-123",
      agentId: null,
    });
  });

  it("recognises a subagent transcript", () => {
    expect(
      claudeCodeSourceAdapter.classifyChange(`${ROOT}/-home-someone-repo/agent-xyz-789.jsonl`, [
        ROOT,
      ]),
    ).toStrictEqual({
      sourceId: "claude-code",
      projectStoragePath: `${ROOT}/-home-someone-repo`,
      sessionId: "xyz-789",
      agentId: "xyz-789",
    });
  });

  it("ignores paths outside every root", () => {
    expect(
      claudeCodeSourceAdapter.classifyChange("/somewhere/else/-p/abc.jsonl", [ROOT]),
    ).toBeNull();
  });

  it("ignores files that are not transcripts", () => {
    expect(
      claudeCodeSourceAdapter.classifyChange(`${ROOT}/-home-someone-repo/notes.txt`, [ROOT]),
    ).toBeNull();
  });

  it("ignores a path that only looks like the root", () => {
    expect(
      claudeCodeSourceAdapter.classifyChange(`${ROOT}-backup/-p/abc.jsonl`, [ROOT]),
    ).toBeNull();
  });
});

describe("claudeCodeSourceAdapter reading the fixture home", () => {
  it.live("lists every project directory without reading a transcript", () =>
    Effect.gen(function* () {
      const projects = yield* claudeCodeSourceAdapter.listProjects();

      expect(projects.length).toBeGreaterThan(0);
      expect(projects.every((project) => project.sourceId === "claude-code")).toBe(true);
      // cwd is deliberately deferred — resolving it means parsing a transcript.
      expect(projects.every((project) => project.cwd === null)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("resolves a project's working directory on demand", () =>
    Effect.gen(function* () {
      const projects = yield* claudeCodeSourceAdapter.listProjects();
      const project = projects.find((candidate) =>
        candidate.sourceProjectKey.endsWith("-home-demo-orders-api"),
      );
      if (project === undefined) {
        throw new Error("fixture project missing");
      }

      expect(yield* claudeCodeSourceAdapter.resolveProjectCwd(project)).toBe("/home/demo/api");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("reads a session into conversation entries", () =>
    Effect.gen(function* () {
      const projects = yield* claudeCodeSourceAdapter.listProjects();
      const project = projects.find((candidate) =>
        candidate.sourceProjectKey.endsWith("-home-demo-orders-api"),
      );
      if (project === undefined) {
        throw new Error("fixture project missing");
      }

      const refs = yield* claudeCodeSourceAdapter.listSessions(project);
      const ref = refs.at(0);
      if (ref === undefined) {
        throw new Error("fixture session missing");
      }

      const session = yield* claudeCodeSourceAdapter.readSession(ref);

      expect(session.entries.length).toBeGreaterThan(0);
      expect(session.messageCount).toBeGreaterThan(0);
      expect(session.usageTexts.length).toBeGreaterThan(0);
      expect(session.parseStats.unparsed).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("reports a session that no longer exists as gone", () =>
    Effect.gen(function* () {
      const projects = yield* claudeCodeSourceAdapter.listProjects();
      const project = projects.at(0);
      if (project === undefined) {
        throw new Error("fixture project missing");
      }

      const result = yield* Effect.either(
        claudeCodeSourceAdapter.resolveSessionRef(project.storagePath, "does-not-exist"),
      );

      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("only claims support after parsing a real transcript", () =>
    Effect.gen(function* () {
      const detection = yield* claudeCodeSourceAdapter.detect();

      expect(detection.sourceId).toBe("claude-code");
      expect(detection.hasData).toBe(true);
      expect(detection.supported).toBe(true);
      expect(detection.unsupportedReason).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("reports an absent home as not installed", () =>
    Effect.gen(function* () {
      const detection = yield* claudeCodeSourceAdapter.detect();

      expect(detection.rootPath).toBeNull();
      expect(detection.supported).toBe(false);
      expect(detection.unsupportedReason).toBe("not-installed");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          testPlatformLayer({
            claudeCodePaths: { claudeProjectsDirPath: "/nonexistent/claude/projects" },
          }),
          NodeFileSystem.layer,
        ),
      ),
    ),
  );
});
