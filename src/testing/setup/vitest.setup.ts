/**
 * React only treats a run as an act environment when this flag is set, and
 * nothing else here sets it: the component tests drive React directly with
 * `act` from react and `createRoot`, rather than through a library that would
 * set it for them. Without it React writes "The current testing environment is
 * not configured to support act(...)" for every render — 90 lines of it in a
 * full CI run, drowning the output that matters.
 *
 * It only surfaces on some platforms, so a local run can look clean while CI is
 * full of it. Setting it unconditionally is correct either way.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
});

export {};
