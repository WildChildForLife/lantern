import { Select } from "./Select.tsx";

type ConfirmProps = {
  initialValue?: boolean | undefined;
  onSubmit: (value: boolean) => void;
};

/**
 * A yes/no prompt, built on Select so the arrow keys, the hotkeys and the
 * highlight all behave the same way they do everywhere else in the wizard.
 */
export const Confirm = ({ initialValue, onSubmit }: ConfirmProps) => (
  <Select
    options={[
      { value: "yes", label: "Yes", hotkey: "y" },
      { value: "no", label: "No", hotkey: "n" },
    ]}
    initialValue={initialValue === false ? "no" : "yes"}
    onSubmit={(value) => {
      onSubmit(value === "yes");
    }}
  />
);
