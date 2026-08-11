import { useAtomValue } from "@effect/atom-react";
import { useRef } from "react";
import type { BranchNamingConfig, SourceControlWritingStyleMode } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager, stackedThreadToast } from "../ui/toast";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> =
  {
    repo_conventions: {
      label: "Repository conventions",
      description: "In each project, matches recent change descriptions and change request titles.",
    },
    conventional_commits: {
      label: "Conventional Commits",
      description:
        "Uses Conventional Commit prefixes for change descriptions; change request titles and descriptions stay concise.",
    },
    custom: {
      label: "Custom instructions",
      description:
        "Applies your instructions to change descriptions and change request titles and descriptions in every project.",
    },
  };

const BRANCH_NAMING_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

const BRANCH_NAMING_MODE_OPTIONS: Record<
  BranchNamingConfig["mode"],
  { label: string; description: string }
> = {
  prefix: {
    label: "Custom prefix",
    description: 'Generated worktree branch names use a fixed prefix (defaults to "t3code").',
  },
  conventional: {
    label: "Conventional prefixes",
    description:
      "The model picks between feature, bugfix, hotfix, release, and chore based on the task.",
  },
  none: {
    label: "No prefix",
    description: "Generated worktree branch names are bare slugs without a prefix segment.",
  },
};

export function SourceControlWritingSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isSourceControlWritingStyleDirty =
    style.mode !== defaults.mode || style.customInstructions !== defaults.customInstructions;

  const defaultModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const resolvedSourceControlWriterSelection = resolveSourceControlWriterModelSelection(
    settings,
    serverProviders,
  );
  const activeSelection =
    resolvedSourceControlWriterSelection === settings.textGenerationModelSelection
      ? defaultModelSelection
      : resolvedSourceControlWriterSelection;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );

  const branchNaming = settings.branchNaming;
  const branchNamingDefaults = DEFAULT_UNIFIED_SETTINGS.branchNaming;
  const storedBranchPrefix = branchNaming.mode === "prefix" ? (branchNaming.prefix ?? "") : "";
  const isBranchNamingDirty =
    branchNaming.mode !== branchNamingDefaults.mode || storedBranchPrefix.length > 0;
  const commitBranchPrefix = (rawValue: string) => {
    if (branchNaming.mode !== "prefix") return;
    const trimmed = rawValue.trim().toLowerCase();
    if (trimmed === storedBranchPrefix) return;
    if (trimmed.length === 0) {
      updateSettings({ branchNaming: { mode: "prefix" } });
      return;
    }
    if (!BRANCH_NAMING_PREFIX_PATTERN.test(trimmed)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Invalid branch prefix",
          description: "Use lowercase letters, digits, dots, dashes, or underscores (no slashes).",
        }),
      );
      return;
    }
    updateSettings({ branchNaming: { mode: "prefix", prefix: trimmed } });
  };

  return (
    <SettingsSection title="Text generation">
      <SettingsRow
        title="Source control writing style"
        description={MODE_OPTIONS[style.mode].description}
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label="source control writing style"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                    customInstructions: defaults.customInstructions,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => {
              const customInstructions = customInstructionsRef.current?.value.trim();
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                  ...(customInstructions !== undefined ? { customInstructions } : {}),
                },
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Source control writing style">
              <SelectValue>{MODE_OPTIONS[style.mode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {MODE_OPTIONS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {style.mode === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={style.customInstructions}
              ref={customInstructionsRef}
              defaultValue={style.customInstructions}
              onBlur={(event) => {
                const customInstructions = event.target.value.trim();
                if (customInstructions !== style.customInstructions) {
                  updateSettings({ sourceControlWritingStyle: { customInstructions } });
                }
              }}
              rows={4}
              placeholder="Keep titles concise. Use short bullet points in descriptions."
              aria-label="Custom source control writing instructions"
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Follow change request templates"
        description="Structures change request descriptions using the current repository's template when one is available."
        resetAction={
          style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label="change request templates"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              updateSettings({
                sourceControlWritingStyle: {
                  followChangeRequestTemplates: Boolean(checked),
                },
              })
            }
            aria-label="Follow change request templates"
          />
        }
      />

      <SettingsRow
        title="Branch naming"
        description={BRANCH_NAMING_MODE_OPTIONS[branchNaming.mode].description}
        resetAction={
          isBranchNamingDirty ? (
            <SettingResetButton
              label="branch naming"
              onClick={() => updateSettings({ branchNaming: branchNamingDefaults })}
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {branchNaming.mode === "prefix" ? (
              <Input
                key={storedBranchPrefix}
                aria-label="Branch prefix"
                className="h-8 w-28"
                defaultValue={storedBranchPrefix}
                placeholder="t3code"
                spellCheck={false}
                onBlur={(event) => commitBranchPrefix(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitBranchPrefix(event.currentTarget.value);
                  }
                }}
              />
            ) : null}
            <Select
              value={branchNaming.mode}
              onValueChange={(value) => {
                if (value === "prefix") {
                  updateSettings({ branchNaming: { mode: "prefix" } });
                } else if (value === "conventional" || value === "none") {
                  updateSettings({ branchNaming: { mode: value } });
                }
              }}
            >
              <SelectTrigger aria-label="Branch naming mode">
                <SelectValue>{BRANCH_NAMING_MODE_OPTIONS[branchNaming.mode].label}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(BRANCH_NAMING_MODE_OPTIONS) as BranchNamingConfig["mode"][]).map(
                  (mode) => (
                    <SelectItem key={mode} hideIndicator value={mode}>
                      {BRANCH_NAMING_MODE_OPTIONS[mode].label}
                    </SelectItem>
                  ),
                )}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="Auto-generate branch names"
        description="Let the model rename new worktree branches once it understands the task. Projects can override this."
        resetAction={
          settings.autoGenerateBranchNames !== DEFAULT_UNIFIED_SETTINGS.autoGenerateBranchNames ? (
            <SettingResetButton
              label="branch auto-naming"
              onClick={() =>
                updateSettings({
                  autoGenerateBranchNames: DEFAULT_UNIFIED_SETTINGS.autoGenerateBranchNames,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.autoGenerateBranchNames}
            onCheckedChange={(checked) =>
              updateSettings({ autoGenerateBranchNames: Boolean(checked) })
            }
            aria-label="Auto-generate branch names"
          />
        }
      />

      <SettingsRow
        title="Source control writer model"
        description="Optional model override for change descriptions, change request titles and descriptions, and branch or bookmark names. Off uses the global text generation model."
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {usesDedicatedModel ? (
              <ProviderModelPicker
                activeInstanceId={activeSelection.instanceId}
                model={activeSelection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                triggerAriaLabel="Source control writer model"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                  });
                }}
              />
            ) : null}
            <Switch
              checked={usesDedicatedModel}
              onCheckedChange={(checked) =>
                updateSettings({
                  sourceControlWriterModelSelection: checked
                    ? createModelSelection(
                        defaultModelSelection.instanceId,
                        defaultModelSelection.model,
                        defaultModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label="Use a separate source control writer model"
            />
          </div>
        }
      />
    </SettingsSection>
  );
}
