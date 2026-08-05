// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const importStorageKey = () => import("./storageKey.ts");

describe("storageKey", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("namespaces a key", async () => {
    const { storageKey } = await importStorageKey();

    expect(storageKey("view-mode")).toBe("lantern-view-mode");
  });

  it("carries a value written under the old prefix over on first load", async () => {
    window.localStorage.setItem("claude-code-viewer-view-mode", '"table"');

    const { storageKey } = await importStorageKey();

    expect(window.localStorage.getItem(storageKey("view-mode"))).toBe('"table"');
  });

  it("leaves the legacy entry in place for older builds", async () => {
    window.localStorage.setItem("claude-code-viewer-view-mode", '"grid"');

    await importStorageKey();

    expect(window.localStorage.getItem("claude-code-viewer-view-mode")).toBe('"grid"');
  });

  it("never overwrites a value already written under the new prefix", async () => {
    window.localStorage.setItem("claude-code-viewer-view-mode", '"grid"');
    window.localStorage.setItem("lantern-view-mode", '"list"');

    await importStorageKey();

    expect(window.localStorage.getItem("lantern-view-mode")).toBe('"list"');
  });

  it("ignores keys belonging to other applications", async () => {
    window.localStorage.setItem("something-else", "keep");

    await importStorageKey();

    expect(window.localStorage.getItem("lantern-else")).toBeNull();
    expect(window.localStorage.length).toBe(1);
  });
});
