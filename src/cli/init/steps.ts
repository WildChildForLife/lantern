import type { SourceId } from "../../server/core/source/models/SourceId.ts";

export type WizardStep =
  | "sources"
  | "claude-dir"
  | "executable"
  | "port"
  | "hostname"
  | "password"
  | "terminal"
  | "sync"
  | "done";

/** The question each step asks, shown as its heading. */
export const WIZARD_STEPS = {
  sources: "Which agent CLIs should Lantern read?",
  "claude-dir": "Where does Claude Code keep its logs?",
  executable: "Where is the claude executable?",
  port: "Which port should the web UI listen on?",
  hostname: "Which address should it bind to?",
  password: "Binding beyond this machine",
  terminal: "Enable the in-app terminal?",
  sync: "Read your conversation logs now?",
} as const satisfies Record<Exclude<WizardStep, "done">, string>;

/** Answers the step order depends on. */
export type StepContext = {
  sources: readonly SourceId[];
  hostname: string;
};

/**
 * Whether a bind address only this machine can reach.
 *
 * `localhost` counts: Lantern resolves it to `127.0.0.1` before binding, so
 * treating it as reachable would demand a password for a loopback-only server.
 */
export const isLoopback = (hostname: string): boolean =>
  hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";

/**
 * Which question comes next.
 *
 * Pure, and separate from the component, because most of the wizard's
 * behaviour is which questions it does *not* ask: no executable to find when
 * Claude Code is not being read, and no password warning for a loopback bind.
 *
 * What Enter does on a conversation is deliberately not asked here — it is
 * shown on the board and switched there, where the user can see what it
 * applies to.
 */
export const nextStep = (current: WizardStep, context: StepContext): WizardStep => {
  const readsClaudeCode = context.sources.includes("claude-code");

  switch (current) {
    case "sources":
      return readsClaudeCode ? "claude-dir" : "port";
    case "claude-dir":
      return readsClaudeCode ? "executable" : "port";
    case "executable":
      return "port";
    case "port":
      return "hostname";
    case "hostname":
      return isLoopback(context.hostname) ? "terminal" : "password";
    case "password":
      return "terminal";
    case "terminal":
      return "sync";
    case "sync":
    case "done":
      return "done";
    default:
      current satisfies never;
      return "done";
  }
};
