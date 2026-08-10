import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ClassifyCallout } from "./ClassifyCallout.tsx";

const ESC = String.fromCodePoint(0x1b);

const plain = (frame: string | undefined): string =>
  (frame ?? "").replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

describe("ClassifyCallout", () => {
  it("asks for the sort, and says how much there is to sort", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={69} classifying={false} />);

    expect(plain(lastFrame())).toContain("t");
    expect(plain(lastFrame())).toContain("sort 69 conversations into topics");
  });

  it("counts one conversation as a conversation", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={1} classifying={false} />);

    expect(plain(lastFrame())).toContain("sort 1 conversation into topics");
  });

  /** The key is drawn as a key, in colour, so it does not read as prose. */
  it("draws the key so it stands out from the text around it", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={4} classifying={false} />);

    // 7 is reverse video, 1 is bold — skipped where the test terminal is monochrome.
    if (!(lastFrame() ?? "").includes(`${ESC}[7m`)) {
      return;
    }

    expect(lastFrame()).toContain(`${ESC}[1m`);
  });

  /**
   * Hiding the row when nothing was pending was tried first and was a mistake:
   * a key nobody can find until the day it matters is a key nobody knows about.
   * With nothing pending it leads with T, which would actually do something,
   * rather than inviting an empty pass.
   */
  it("still says where sorting lives when every conversation has a topic", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={0} classifying={false} />);

    expect(plain(lastFrame())).toContain("every conversation has a topic");
    expect(plain(lastFrame())).toContain("T");
    expect(plain(lastFrame())).toContain("re-sorts all of them");
  });

  it("does not invite a pass over nothing", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={0} classifying={false} />);

    expect(plain(lastFrame())).not.toContain("sort 0");
  });

  it("becomes the progress line while a pass runs", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={69} classifying />);

    expect(plain(lastFrame())).toContain("sorting into topics…");
    expect(plain(lastFrame())).toContain("this can take a while");
  });

  /** Nothing left to sort, but a pass still running, still has to report itself. */
  it("reports a running pass even with nothing left unsorted", () => {
    const { lastFrame } = render(<ClassifyCallout unclassified={0} classifying />);

    expect(plain(lastFrame())).toContain("sorting into topics…");
  });
});
