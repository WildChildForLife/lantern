import { Box, Text, useApp } from "ink";
import { useState } from "react";
import type { SourceId } from "../../server/core/source/models/SourceId.ts";
import type { ResumeAction } from "../config/cliConfig.ts";
import { Confirm } from "../ui/prompts/Confirm.tsx";
import { MultiSelect } from "../ui/prompts/MultiSelect.tsx";
import { Select } from "../ui/prompts/Select.tsx";
import { TextInput } from "../ui/prompts/TextInput.tsx";
import { theme } from "../ui/theme.ts";
import type { Detection } from "./detect.ts";
import { nextStep, WIZARD_STEPS, type WizardStep } from "./steps.ts";

export type WizardAnswers = {
  sources: SourceId[];
  claudeDir: string | undefined;
  executable: string | undefined;
  port: number;
  hostname: string;
  terminalDisabled: boolean;
  resumeAction: ResumeAction;
  terminalCommand: string | undefined;
  runSync: boolean;
};

type InitWizardProps = {
  detection: Detection;
  /** Settings already on disk, so re-running the wizard starts from them. */
  initial: Partial<WizardAnswers>;
  onDone: (answers: WizardAnswers) => void;
};

const DEFAULT_PORT = 3000;

const parsePort = (value: string): number | null => {
  const port = Number.parseInt(value, 10);

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

/**
 * The setup wizard.
 *
 * Every question arrives with the detected answer already filled in, so the
 * fast path through it is Enter nine times. The order itself lives in
 * `nextStep`, which decides what to skip.
 */
export const InitWizard = ({ detection, initial, onDone }: InitWizardProps) => {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>("sources");
  const [answers, setAnswers] = useState<WizardAnswers>({
    sources:
      initial.sources ?? detection.sources.filter((source) => source.usable).map((s) => s.id),
    claudeDir: initial.claudeDir ?? detection.claudeDirectory,
    executable: initial.executable ?? detection.executable ?? undefined,
    port: initial.port ?? DEFAULT_PORT,
    hostname: initial.hostname ?? "127.0.0.1",
    terminalDisabled: initial.terminalDisabled ?? !detection.terminalAvailable,
    resumeAction: initial.resumeAction ?? "resume-here",
    terminalCommand: initial.terminalCommand,
    runSync: true,
  });

  /** Advances using the answers as they are *after* this step. */
  const advance = (patch: Partial<WizardAnswers>) => {
    const merged = { ...answers, ...patch };
    setAnswers(merged);

    const following = nextStep(step, merged);
    if (following === "done") {
      onDone(merged);
      exit();
      return;
    }

    setStep(following);
  };

  if (step === "done") {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          Lantern setup
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold>{WIZARD_STEPS[step]}</Text>
      </Box>

      {step === "sources" ? (
        <MultiSelect
          options={detection.sources.map((source) => ({
            value: source.id,
            label: source.displayName,
            hint:
              source.rootPath === null
                ? "not found on this machine"
                : source.usable
                  ? source.rootPath
                  : `${source.rootPath} — nothing readable yet`,
          }))}
          initialSelected={answers.sources}
          onSubmit={(sources) => {
            // Reading nothing would leave an empty dashboard and no way back.
            advance({ sources: sources.length === 0 ? ["claude-code"] : sources });
          }}
        />
      ) : null}

      {step === "claude-dir" ? (
        <TextInput
          placeholder={detection.claudeDirectory}
          onSubmit={(claudeDir) => {
            advance({ claudeDir });
          }}
        />
      ) : null}

      {step === "executable" ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              {detection.executable === null
                ? "Not found on PATH. Leave blank to keep looking at start-up."
                : `Found ${detection.executable}. Enter to keep it.`}
            </Text>
          </Box>
          <TextInput
            placeholder={detection.executable ?? ""}
            onSubmit={(executable) => {
              advance({ executable: executable === "" ? undefined : executable });
            }}
          />
        </Box>
      ) : null}

      {step === "port" ? (
        <TextInput
          placeholder={String(answers.port)}
          validate={(value) => (parsePort(value) === null ? "Ports run from 1 to 65535." : null)}
          onSubmit={(value) => {
            advance({ port: parsePort(value) ?? DEFAULT_PORT });
          }}
        />
      ) : null}

      {step === "hostname" ? (
        <Select
          options={[
            { value: "127.0.0.1", label: "127.0.0.1", hint: "this machine only" },
            { value: "::1", label: "::1", hint: "this machine only, over IPv6" },
            { value: "::", label: "::", hint: "every interface, IPv4 and IPv6" },
            { value: "0.0.0.0", label: "0.0.0.0", hint: "every interface" },
          ]}
          initialValue={answers.hostname}
          onSubmit={(hostname) => {
            advance({ hostname });
          }}
        />
      ) : null}

      {step === "password" ? (
        <Box flexDirection="column">
          <Text color={theme.danger}>
            Lantern ships an in-app terminal. Binding to {answers.hostname} without a password hands
            a shell to whoever finds the port.
          </Text>
          <Box marginTop={1} marginBottom={1}>
            <Text dimColor>
              Set one with LANTERN_PASSWORD, or pass --password. It is deliberately not written to
              the settings file, so it stays out of your backups and dotfiles.
            </Text>
          </Box>
          <Confirm
            onSubmit={() => {
              advance({});
            }}
          />
        </Box>
      ) : null}

      {step === "terminal" ? (
        <Box flexDirection="column">
          {detection.terminalAvailable ? null : (
            <Box marginBottom={1}>
              <Text dimColor>No prebuilt PTY binary for this platform, so it cannot run here.</Text>
            </Box>
          )}
          <Confirm
            initialValue={!answers.terminalDisabled}
            onSubmit={(enabled) => {
              advance({ terminalDisabled: !enabled });
            }}
          />
        </Box>
      ) : null}

      {step === "resume-action" ? (
        <Select
          options={[
            {
              value: "resume-here",
              label: "Resume here",
              hint: "replaces the board with the conversation",
            },
            {
              value: "new-window",
              label: "Open a new terminal window",
              hint: "leaves the board up",
            },
            { value: "print", label: "Print the command", hint: "quits and writes it out" },
            { value: "copy-id", label: "Copy the conversation id" },
          ]}
          initialValue={answers.resumeAction}
          onSubmit={(resumeAction) => {
            advance({ resumeAction });
          }}
        />
      ) : null}

      {step === "emulator" ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Leave blank to detect one. {"{{command}}"} and {"{{cwd}}"} are filled in.
            </Text>
          </Box>
          <TextInput
            initialValue={answers.terminalCommand ?? ""}
            onSubmit={(terminalCommand) => {
              advance({ terminalCommand: terminalCommand === "" ? undefined : terminalCommand });
            }}
          />
        </Box>
      ) : null}

      {step === "sync" ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Builds the cache now, so the first board and the first page load are not a wait.
            </Text>
          </Box>
          <Confirm
            onSubmit={(runSync) => {
              advance({ runSync });
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
};
