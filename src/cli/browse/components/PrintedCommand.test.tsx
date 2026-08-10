import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { PrintedCommandPanel } from "./PrintedCommand.tsx";

const ESC = String.fromCodePoint(0x1b);

const plain = (frame: string | undefined): string =>
  (frame ?? "").replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("PrintedCommandPanel", () => {
  it("shows the command and the directory it has to be run in", () => {
    const { lastFrame } = render(
      <PrintedCommandPanel
        printed={{ cwd: "/home/dev/lantern", text: `claude --resume "s-refund"`, token: 1 }}
        width={80}
      />,
    );

    expect(plain(lastFrame())).toContain("cd /home/dev/lantern");
    expect(plain(lastFrame())).toContain(`claude --resume "s-refund"`);
  });

  it("says that another p replaces it, rather than adding to it", () => {
    const { lastFrame } = render(
      <PrintedCommandPanel
        printed={{ cwd: "/home/dev/lantern", text: "claude --resume x", token: 1 }}
        width={80}
      />,
    );

    expect(plain(lastFrame())).toContain("replaces it");
  });

  /**
   * The blink is what tells the user a second `p` did anything: the panel is in
   * the same place and, for the same conversation, says the same thing.
   */
  it("settles on a readable panel once the blinking is over", async () => {
    const { lastFrame, rerender } = render(
      <PrintedCommandPanel
        printed={{ cwd: "/home/dev/lantern", text: "claude --resume x", token: 1 }}
        width={80}
      />,
    );

    rerender(
      <PrintedCommandPanel
        printed={{ cwd: "/home/dev/lantern", text: "claude --resume y", token: 2 }}
        width={80}
      />,
    );

    for (let step = 0; step < 8; step += 1) {
      await nextFrame();
    }

    expect(plain(lastFrame())).toContain("claude --resume y");
  });
});
