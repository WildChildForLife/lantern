import { Trans, useLingui } from "@lingui/react";
import { PlusIcon, XIcon } from "lucide-react";
import { type FC, useId, useState } from "react";
import { useConfig } from "@/web/app/hooks/useConfig";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

const ENTER_KEY_BEHAVIORS = ["shift-enter-send", "enter-send", "command-enter-send"] as const;

const isSearchHotkey = (value: string): value is "ctrl-k" | "command-k" =>
  value === "ctrl-k" || value === "command-k";

const isFindHotkey = (value: string): value is "ctrl-f" | "command-f" =>
  value === "ctrl-f" || value === "command-f";

/**
 * Keyboard behaviour and the model list, split out of `SettingsControls` so it
 * stays under the 500-line cap now the panel has sections.
 */
export const InputSettings: FC<{ showLabels?: boolean; showDescriptions?: boolean }> = ({
  showLabels = true,
  showDescriptions = true,
}) => {
  const { i18n } = useLingui();
  const { config, updateConfig } = useConfig();
  const [newModelChoice, setNewModelChoice] = useState("");

  const enterKeyBehaviorId = useId();
  const searchHotkeyId = useId();
  const findHotkeyId = useId();

  const changeEnterKeyBehavior = (value: string) => {
    const matched = ENTER_KEY_BEHAVIORS.find((behavior) => behavior === value);
    if (matched === undefined) return;
    updateConfig({ ...config, enterKeyBehavior: matched });
  };

  const changeSearchHotkey = (value: string) => {
    if (!isSearchHotkey(value)) return;
    updateConfig({ ...config, searchHotkey: value });
  };

  const changeFindHotkey = (value: string) => {
    if (!isFindHotkey(value)) return;
    updateConfig({ ...config, findHotkey: value });
  };

  const addModelChoice = () => {
    const trimmed = newModelChoice.trim();
    if (trimmed === "" || config?.modelChoices?.includes(trimmed) === true) return;
    updateConfig({ ...config, modelChoices: [...(config?.modelChoices ?? []), trimmed] });
    setNewModelChoice("");
  };

  const removeModelChoice = (choice: string) => {
    updateConfig({
      ...config,
      modelChoices: (config?.modelChoices ?? []).filter((entry) => entry !== choice),
    });
  };

  return (
    <>
      <div className="space-y-2">
        {showLabels && (
          <label htmlFor={enterKeyBehaviorId} className="text-sm font-medium leading-none">
            <Trans id="settings.input.enter_key_behavior" />
          </label>
        )}
        <Select
          value={config?.enterKeyBehavior || "shift-enter-send"}
          onValueChange={changeEnterKeyBehavior}
        >
          <SelectTrigger id={enterKeyBehaviorId} className="w-full">
            <SelectValue placeholder={i18n._("Select enter key behavior")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shift-enter-send">
              <Trans id="settings.input.enter_key_behavior.shift_enter" />
            </SelectItem>
            <SelectItem value="enter-send">
              <Trans id="settings.input.enter_key_behavior.enter" />
            </SelectItem>
            <SelectItem value="command-enter-send">
              <Trans id="settings.input.enter_key_behavior.command_enter" />
            </SelectItem>
          </SelectContent>
        </Select>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans id="settings.input.enter_key_behavior.description" />
          </p>
        )}
      </div>

      <div className="space-y-2">
        {showLabels && (
          <label htmlFor={searchHotkeyId} className="text-sm font-medium leading-none">
            <Trans id="settings.input.search_hotkey" />
          </label>
        )}
        <Select value={config?.searchHotkey || "command-k"} onValueChange={changeSearchHotkey}>
          <SelectTrigger id={searchHotkeyId} className="w-full">
            <SelectValue placeholder={i18n._("Select search hotkey")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ctrl-k">
              <Trans id="settings.input.search_hotkey.ctrl_k" />
            </SelectItem>
            <SelectItem value="command-k">
              <Trans id="settings.input.search_hotkey.command_k" />
            </SelectItem>
          </SelectContent>
        </Select>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans id="settings.input.search_hotkey.description" />
          </p>
        )}
      </div>

      <div className="space-y-2">
        {showLabels && (
          <label htmlFor={findHotkeyId} className="text-sm font-medium leading-none">
            <Trans id="settings.input.find_hotkey" />
          </label>
        )}
        <Select value={config?.findHotkey || "command-f"} onValueChange={changeFindHotkey}>
          <SelectTrigger id={findHotkeyId} className="w-full">
            <SelectValue placeholder={i18n._("Select find hotkey")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ctrl-f">
              <Trans id="settings.input.find_hotkey.ctrl_f" />
            </SelectItem>
            <SelectItem value="command-f">
              <Trans id="settings.input.find_hotkey.command_f" />
            </SelectItem>
          </SelectContent>
        </Select>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans id="settings.input.find_hotkey.description" />
          </p>
        )}
      </div>

      <div className="space-y-2">
        {showLabels && (
          <span className="text-sm font-medium leading-none block">
            <Trans id="settings.model_choices.label" message="Model Choices" />
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {(config?.modelChoices ?? []).map((choice) => (
            <span
              key={choice}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs"
            >
              {choice}
              <button
                type="button"
                onClick={() => removeModelChoice(choice)}
                className="hover:bg-primary/20 rounded-full p-0.5"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newModelChoice}
            onChange={(e) => setNewModelChoice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModelChoice();
              }
            }}
            placeholder={i18n._({
              id: "settings.model_choices.placeholder",
              message: "Add model choice...",
            })}
            className="h-8 text-xs flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addModelChoice}
            disabled={newModelChoice.trim() === ""}
            className="h-8 text-xs"
          >
            <PlusIcon className="w-3 h-3" />
          </Button>
        </div>
        {showDescriptions && (
          <p className="text-xs text-muted-foreground mt-1">
            <Trans
              id="settings.model_choices.description"
              message="Configure the model options available in the session toolbar"
            />
          </p>
        )}
      </div>
    </>
  );
};
