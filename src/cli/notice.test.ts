import { describe, expect, it } from "vitest";
import { makeNoticeOnce } from "./notice.ts";

describe("makeNoticeOnce", () => {
  it("writes the message, with the newline the caller did not have to add", () => {
    const written: string[] = [];
    const notice = makeNoticeOnce((line) => written.push(line));

    notice("Settings could not be read.");

    expect(written).toEqual(["Settings could not be read.\n"]);
  });

  /** A launch that offers the wizard and is refused loads settings twice. */
  it("says the same message once, however many times it is asked", () => {
    const written: string[] = [];
    const notice = makeNoticeOnce((line) => written.push(line));

    notice("Settings could not be read.");
    notice("Settings could not be read.");
    notice("Settings could not be read.");

    expect(written).toHaveLength(1);
  });

  it("still says a different message", () => {
    const written: string[] = [];
    const notice = makeNoticeOnce((line) => written.push(line));

    notice("first");
    notice("second");

    expect(written).toEqual(["first\n", "second\n"]);
  });

  /** Two files unreadable is two problems, and the path is what tells them apart. */
  it("treats messages naming different paths as different messages", () => {
    const written: string[] = [];
    const notice = makeNoticeOnce((line) => written.push(line));

    notice("Could not read /a/config.json");
    notice("Could not read /b/config.json");

    expect(written).toHaveLength(2);
  });

  it("keeps its own record, so one instance cannot silence another", () => {
    const first: string[] = [];
    const second: string[] = [];
    const noticeFirst = makeNoticeOnce((line) => first.push(line));
    const noticeSecond = makeNoticeOnce((line) => second.push(line));

    noticeFirst("same");
    noticeSecond("same");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});
