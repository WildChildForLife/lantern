import { describe, expect, test } from "vitest";
import { ConversationSchema } from "./index.ts";

describe("ConversationSchema", () => {
  test("accepts ai-title entries", () => {
    const data = ConversationSchema.parse({
      type: "ai-title",
      aiTitle: "macro-dashboard のフォントと UI デザイン修正",
      sessionId: "379ea227-4913-484f-9a55-fc76a9fc215f",
    });

    if (data.type !== "ai-title") {
      throw new Error("Expected ai-title entry");
    }
    expect(data.aiTitle).toBe("macro-dashboard のフォントと UI デザイン修正");
  });

  test("accepts atis-latch entries", () => {
    const data = ConversationSchema.parse({
      type: "atis-latch",
      atis: "",
      sessionId: "b3f136a7-5d62-494d-b630-d103919f82e2",
    });

    if (data.type !== "atis-latch") {
      throw new Error("Expected atis-latch entry");
    }
    expect(data.atis).toBe("");
  });

  test("accepts away_summary system entries with entrypoint and slug", () => {
    const data = ConversationSchema.parse({
      parentUuid: "bde9c218-c40b-4d1c-9f2d-643d5fb22bc9",
      isSidechain: false,
      type: "system",
      subtype: "away_summary",
      content:
        "Building `sb`, a Swift CLI replacing your `sb` + `dm` scripts; `PLAN.md` is written with 6 phases. Next: start Phase 0, the Makefile and Swift scaffolding. (disable recaps in /config)",
      timestamp: "2026-04-21T12:22:43.974Z",
      uuid: "1db9cd52-9a46-4172-8ec9-df8b9c416ed4",
      isMeta: false,
      userType: "external",
      entrypoint: "cli",
      cwd: "/path/to/project/here",
      sessionId: "4dbd4176-6757-48e0-bdde-026de415f8fa",
      version: "2.1.116",
      gitBranch: "main",
      slug: "temporal-twirling-plum",
    });

    if (data.type !== "system") {
      throw new Error("Expected system entry");
    }
    expect(data.entrypoint).toBe("cli");
    expect(data.slug).toBe("temporal-twirling-plum");
  });

  test("accepts assistant usage fields emitted by non-Anthropic providers", () => {
    const data = ConversationSchema.parse({
      parentUuid: "8f9e1331-6298-4da4-837a-d4df6ba8e3b7",
      isSidechain: false,
      message: {
        model: "kimi-k2.5",
        id: "msg_79158e71-574d-494c-9e98-91a9d802a076",
        role: "assistant",
        type: "message",
        content: [
          {
            name: "Bash",
            input: {
              command: "ls -lh test-document.docx && rm create-doc.js",
              description: "Verify document exists and cleanup script",
            },
            id: "toolu_functions.Bash:6",
            type: "tool_use",
          },
        ],
        usage: {
          input_tokens: 4,
          cache_creation_input_tokens: 180,
          cache_read_input_tokens: 39242,
          output_tokens: 62,
          server_tool_use: {
            web_search_requests: 0,
            web_fetch_requests: 0,
          },
          service_tier: "standard",
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 180,
          },
          inference_geo: "",
          iterations: [],
          speed: "standard",
        },
        stop_reason: "tool_use",
      },
      type: "assistant",
      uuid: "668d7ff4-0fa0-4a5b-9231-a381aab58fd6",
      timestamp: "2026-04-10T02:29:29.982Z",
      userType: "external",
      entrypoint: "sdk-cli",
      cwd: "/path/to/project",
      sessionId: "163cbdad-1134-4111-afc8-56056143a581",
      version: "2.1.98",
      gitBranch: "main",
      slug: "harmonic-snacking-mccarthy",
    });

    if (data.type !== "assistant") {
      throw new Error("Expected assistant entry");
    }
    expect(data.message.usage?.server_tool_use?.web_fetch_requests).toBe(0);
    expect(data.message.usage?.inference_geo).toBe("");
    expect(data.message.usage?.speed).toBe("standard");
  });

  test("accepts compact file reference attachments", () => {
    const result = ConversationSchema.safeParse({
      parentUuid: "8e7b736e-08dc-477c-b515-0bc9cf2df8fb",
      isSidechain: false,
      attachment: {
        type: "compact_file_reference",
        filename: "/path/to/project/src/a.c",
        displayPath: "src/a.c",
      },
      type: "attachment",
      uuid: "c6f7796c-49e1-488a-ae65-bd95323489b2",
      timestamp: "2026-04-10T16:52:50.109Z",
      userType: "external",
      entrypoint: "cli",
      cwd: "/path/to/project",
      sessionId: "2825293e-3ecd-470e-82de-681376a273a0",
      version: "2.1.100",
      gitBranch: "main",
      slug: "cozy-booping-sky",
    });

    expect(result.success).toBe(true);
  });

  test("accepts file attachments with inline text content", () => {
    const result = ConversationSchema.safeParse({
      parentUuid: "304e740c-4092-4899-9cbc-78856e2316d1",
      isSidechain: false,
      attachment: {
        type: "file",
        filename: "/path/to/project/tests/a.sh",
        content: {
          type: "text",
          file: {
            filePath: "/path/to/project/tests/a.sh",
            content:
              '#!/bin/bash\n# tests/a.sh — T6: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\necho "$PASS passed, $FAIL failed"\n[ "$FAIL" -eq 0 ]\n',
            numLines: 50,
            startLine: 1,
            totalLines: 50,
          },
        },
        displayPath: "tests/a.sh",
      },
      type: "attachment",
      uuid: "42e88b33-d08f-4f3c-9fac-00278668ab98",
      timestamp: "2026-04-10T16:52:49.756Z",
      userType: "external",
      entrypoint: "cli",
      cwd: "/path/to/project",
      sessionId: "2825293e-3ecd-470e-82de-681376a273a0",
      version: "2.1.100",
      gitBranch: "main",
      slug: "cozy-booping-sky",
    });

    expect(result.success).toBe(true);
  });

  /**
   * The entry kinds that used to have no schema at all, so every one of them
   * rendered as a parse error. Each body below is a real line, copied verbatim
   * from a session log rather than written to fit the schema.
   */
  test("accepts mode entries", () => {
    const data = ConversationSchema.parse({
      type: "mode",
      mode: "normal",
      sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
    });

    if (data.type !== "mode") {
      throw new Error("Expected mode entry");
    }
    expect(data.mode).toBe("normal");
  });

  test("accepts relocated entries", () => {
    const data = ConversationSchema.parse({
      type: "relocated",
      sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
      relocatedCwd: "/path/to/project/.claude/worktrees/docs-readme",
    });

    if (data.type !== "relocated") {
      throw new Error("Expected relocated entry");
    }
    expect(data.relocatedCwd).toBe("/path/to/project/.claude/worktrees/docs-readme");
  });

  test("accepts worktree-state entries", () => {
    const data = ConversationSchema.parse({
      type: "worktree-state",
      worktreeSession: {
        originalCwd: "/path/to/project",
        preEnterOriginalCwd: "/path/to/project",
        worktreePath: "/path/to/project/.claude/worktrees/docs-readme",
        worktreeName: "docs-readme",
        worktreeBranch: "worktree-docs-readme",
        originalBranch: "docs/tighten-readme",
        originalHeadCommit: "29baa26a86d77627e6b875e87008d83962a7b896",
        sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
      },
      sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
    });

    if (data.type !== "worktree-state") {
      throw new Error("Expected worktree-state entry");
    }
    expect(data.worktreeSession?.worktreeName).toBe("docs-readme");
  });

  test("accepts worktree-state entries that cleared the worktree", () => {
    const data = ConversationSchema.parse({
      type: "worktree-state",
      worktreeSession: null,
      sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
    });

    if (data.type !== "worktree-state") {
      throw new Error("Expected worktree-state entry");
    }
    expect(data.worktreeSession).toBeNull();
  });

  test("accepts file-history-delta entries, including an unnamed backup", () => {
    const data = ConversationSchema.parse({
      type: "file-history-delta",
      messageId: "7e388961-90c1-4ac9-a304-256cc209b9a7",
      snapshotMessageId: "f2784bf7-9525-4aa2-a6e8-64d4b0e2f4bb",
      trackingPath: "README.md",
      backup: {
        backupFileName: null,
        version: 1,
        backupTime: "2026-08-17T17:30:31.998Z",
        realParentDir: "/path/to/project",
      },
      timestamp: "2026-08-17T17:30:31.999Z",
    });

    if (data.type !== "file-history-delta") {
      throw new Error("Expected file-history-delta entry");
    }
    expect(data.trackingPath).toBe("README.md");
  });

  test("accepts frame-link entries", () => {
    const data = ConversationSchema.parse({
      type: "frame-link",
      sessionId: "66a2bc95-e0a4-406f-b916-178d5b028b06",
      path: "/tmp/scratchpad/prune-review.html",
      frameUrl: "https://claude.ai/code/artifact/61da4ce6-3a8d-4a84-a7de-921b5214c418",
      title: "Prune Review",
      timestamp: "2026-08-07T20:34:57.229Z",
    });

    if (data.type !== "frame-link") {
      throw new Error("Expected frame-link entry");
    }
    expect(data.frameUrl).toBe(
      "https://claude.ai/code/artifact/61da4ce6-3a8d-4a84-a7de-921b5214c418",
    );
  });

  test("accepts last-prompt entries that point at the leaf instead of the text", () => {
    const data = ConversationSchema.parse({
      type: "last-prompt",
      leafUuid: "89254824-d2e5-42f9-b285-08a7d707d8fd",
      sessionId: "9f54ce8c-7925-4746-97cd-c2c034de321f",
    });

    if (data.type !== "last-prompt") {
      throw new Error("Expected last-prompt entry");
    }
    expect(data.leafUuid).toBe("89254824-d2e5-42f9-b285-08a7d707d8fd");
    expect(data.lastPrompt).toBeUndefined();
  });

  test("accepts informational system entries at notice level", () => {
    const data = ConversationSchema.parse({
      parentUuid: "cc4192f3-a6fe-4b14-ae63-17c13f050a67",
      isSidechain: false,
      type: "system",
      subtype: "informational",
      content: "Continuing an interrupted response.",
      isMeta: false,
      timestamp: "2026-07-08T20:19:58.789Z",
      uuid: "3766d157-5112-47ff-b12d-d9f36421a754",
      level: "notice",
      userType: "external",
      cwd: "/path/to/project",
      sessionId: "59e0177d-a6e2-49b9-ae5c-5c9e803c4af2",
      version: "2.1.202",
      gitBranch: "HEAD",
    });

    if (data.type !== "system") {
      throw new Error("Expected system entry");
    }
    expect(data.subtype).toBe("informational");
  });

  /**
   * Synthetic assistant messages - the rate-limit notice among them - report
   * these usage fields as null. Rejecting the line hid the very message the
   * reader needed.
   */
  test("accepts assistant messages whose usage fields came back null", () => {
    const data = ConversationSchema.parse({
      parentUuid: "29444f3a-e16b-4a71-a811-7b34de330946",
      isSidechain: true,
      type: "assistant",
      uuid: "c64fb8a3-8a6d-45b9-b359-1f3b1aa31760",
      timestamp: "2026-08-01T00:44:54.744Z",
      userType: "external",
      cwd: "/path/to/project",
      sessionId: "59e0177d-a6e2-49b9-ae5c-5c9e803c4af2",
      version: "2.1.202",
      message: {
        id: "c35955bf-5d73-4677-8c1f-e21d0a56744b",
        container: null,
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "stop_sequence",
        stop_sequence: "",
        type: "message",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          service_tier: null,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          inference_geo: null,
          iterations: null,
          speed: null,
        },
        content: [{ type: "text", text: "You've hit your session limit \u00b7 resets 4:30am" }],
      },
    });

    if (data.type !== "assistant") {
      throw new Error("Expected assistant entry");
    }
    expect(data.message.usage?.inference_geo).toBeNull();
  });
});
