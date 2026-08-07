import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { Confirm } from "./Confirm.tsx";
import { MultiSelect } from "./MultiSelect.tsx";
import { Select } from "./Select.tsx";
import { TextInput } from "./TextInput.tsx";

const ESC = String.fromCodePoint(0x1b);
const ARROW_DOWN = `${ESC}[B`;
const ARROW_UP = `${ESC}[A`;
const ENTER = "\r";
const BACKSPACE = String.fromCodePoint(0x7f);
const ESCAPE = ESC;

/** Ink renders on the next tick, so assertions have to wait for a frame. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 20));

const options = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
  { value: "third", label: "Third", hotkey: "t" },
];

describe("Select", () => {
  it("submits the highlighted option", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Select options={options} onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ARROW_DOWN);
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("second");
  });

  it("starts on the option it was given", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Select options={options} initialValue="third" onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("third");
  });

  it("wraps around the ends of the list", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Select options={options} onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ARROW_UP);
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("third");
  });

  it("picks an option outright by its hotkey", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Select options={options} onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write("t");
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("third");
  });

  it("refuses to submit a disabled option", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <Select
        options={[
          { value: "locked", label: "Locked", disabled: true, disabledReason: "read-only" },
        ]}
        onSubmit={onSubmit}
      />,
    );

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says why an option cannot be picked", async () => {
    const { lastFrame } = render(
      <Select
        options={[
          { value: "locked", label: "Locked", disabled: true, disabledReason: "read-only" },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    await nextFrame();

    expect(lastFrame()).toContain("read-only");
  });
});

describe("MultiSelect", () => {
  it("toggles options with space and submits them in list order", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<MultiSelect options={options} onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ARROW_DOWN);
    await nextFrame();
    stdin.write(" ");
    await nextFrame();
    stdin.write(ARROW_UP);
    await nextFrame();
    stdin.write(" ");
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith(["first", "second"]);
  });

  it("starts with the detected options already ticked", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <MultiSelect options={options} initialSelected={["third"]} onSubmit={onSubmit} />,
    );

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith(["third"]);
  });

  it("untoggles an option that was ticked", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <MultiSelect options={options} initialSelected={["first"]} onSubmit={onSubmit} />,
    );

    await nextFrame();
    stdin.write(" ");
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith([]);
  });
});

describe("TextInput", () => {
  it("submits what was typed", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextInput onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write("3400");
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("3400");
  });

  it("deletes backwards", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextInput onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write("3401");
    await nextFrame();
    stdin.write(BACKSPACE);
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("340");
  });

  /** Every question is pre-filled with a detected answer; enter must take it. */
  it("submits the placeholder when nothing was typed", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextInput placeholder="~/.claude" onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith("~/.claude");
  });

  it("refuses a value the caller rejects, and says why", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <TextInput validate={() => "that is not a port"} onSubmit={onSubmit} />,
    );

    await nextFrame();
    stdin.write("nope");
    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("that is not a port");
  });

  it("cancels on escape when the caller allows it", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<TextInput onSubmit={vi.fn()} onCancel={onCancel} />);

    await nextFrame();
    stdin.write(ESCAPE);
    await nextFrame();

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("Confirm", () => {
  it("answers yes by default", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Confirm onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith(true);
  });

  it("starts on no when that is the safer answer", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Confirm initialValue={false} onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write(ENTER);
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith(false);
  });

  it("takes n as an answer", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Confirm onSubmit={onSubmit} />);

    await nextFrame();
    stdin.write("n");
    await nextFrame();

    expect(onSubmit).toHaveBeenCalledWith(false);
  });
});
