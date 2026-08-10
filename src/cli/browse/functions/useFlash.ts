import { useEffect, useRef, useState } from "react";

/** How long one on or off step of the flash lasts. */
export const FLASH_STEP_MILLIS = 120;

/** Steps in a flash. Odd, so it always settles back on. */
export const FLASH_STEPS = 5;

/**
 * Blinks whenever the token changes.
 *
 * A panel that is replaced in place is otherwise a silent change: the command
 * shown for one conversation looks exactly like the command shown for another,
 * so pressing `p` on a second row appears to do nothing at all. Blinking is the
 * terminal's version of drawing attention to it.
 *
 * The token is what makes a repeat count as a change — printing the same
 * conversation twice has to blink too, and its text is identical.
 */
export const useFlash = (token: number): boolean => {
  const [step, setStep] = useState(0);
  const seen = useRef(token);

  useEffect(() => {
    // A change, not a first sight of it. Appearing is a change the user can see
    // already, and blinking on mount would leave a timer running behind every
    // panel that was simply drawn.
    if (seen.current === token) {
      return;
    }

    seen.current = token;
    setStep(FLASH_STEPS);
  }, [token]);

  useEffect(() => {
    if (step <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setStep(step - 1);
    }, FLASH_STEP_MILLIS);

    return () => {
      clearTimeout(timer);
    };
  }, [step]);

  // Even steps are the dark half of the blink. Zero — settled — is lit, so the
  // panel is readable once the flashing is over.
  return step === 0 || step % 2 === 1;
};
