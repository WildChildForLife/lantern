export type FirstRunContext = {
  /** Whether `~/.lantern/config.json` already exists. */
  configExists: boolean;
  /** Whether both ends of the terminal are attached and can carry a prompt. */
  isInteractive: boolean;
  /** Whether `--no-init` was passed. */
  noInit: boolean;
  env: Record<string, string | undefined>;
};

/**
 * Whether a plain `lantern` should walk the user through setup first.
 *
 * This is the reason the wizard is not an npm `postinstall` hook: package
 * managers, containers and CI all run without a terminal attached, and a
 * prompt there does not ask a question, it hangs the install. Deciding here
 * means the same binary can be interactive for a person and silent for a
 * machine, with no special casing for either.
 */
export const shouldRunWizard = ({
  configExists,
  isInteractive,
  noInit,
  env,
}: FirstRunContext): boolean => {
  if (configExists || noInit || !isInteractive) {
    return false;
  }

  const isCi = env["CI"] !== undefined && env["CI"] !== "";
  const optedOut = env["LANTERN_NO_INIT"] !== undefined && env["LANTERN_NO_INIT"] !== "";

  return !isCi && !optedOut;
};
