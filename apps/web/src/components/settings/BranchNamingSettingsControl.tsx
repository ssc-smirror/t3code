import { BranchNamingPrefix, type BranchNamingConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";

const isBranchNamingPrefix = Schema.is(BranchNamingPrefix);

export function branchNamingLabel(config: BranchNamingConfig): string {
  switch (config.mode) {
    case "prefix":
      return config.prefix ? `Prefix “${config.prefix}”` : "Default prefix";
    case "none":
      return "No prefix";
  }
}

export function branchNamingDescription(config: BranchNamingConfig): string {
  switch (config.mode) {
    case "prefix":
      return 'Generated worktree branch names use a fixed prefix (defaults to "t3code").';
    case "none":
      return "Generated worktree branch names are bare slugs without a prefix segment.";
  }
}

export function BranchNamingSettingsControl({
  value,
  inheritedLabel,
  onChange,
}: {
  value: BranchNamingConfig | null;
  inheritedLabel?: string;
  onChange: (value: BranchNamingConfig | null) => void;
}) {
  const prefix = value?.mode === "prefix" ? (value.prefix ?? "") : "";

  const commitPrefix = (rawValue: string) => {
    if (value?.mode !== "prefix") return;
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === prefix) return;
    if (normalized.length === 0) {
      onChange({ mode: "prefix" });
      return;
    }
    if (!isBranchNamingPrefix(normalized)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Invalid branch prefix",
          description:
            "Use at most 32 lowercase letters, digits, dots, dashes, or underscores (no slashes).",
        }),
      );
      return;
    }
    onChange({ mode: "prefix", prefix: normalized });
  };

  const selectedMode = value?.mode ?? "inherit";
  const selectedLabel =
    value === null ? `Default (${inheritedLabel ?? "inherited"})` : branchNamingLabel(value);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {value?.mode === "prefix" ? (
        <Input
          key={prefix}
          aria-label="Branch prefix"
          className="h-8 w-28"
          defaultValue={prefix}
          maxLength={32}
          placeholder="t3code"
          spellCheck={false}
          onBlur={(event) => commitPrefix(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitPrefix(event.currentTarget.value);
          }}
        />
      ) : null}
      <Select
        value={selectedMode}
        onValueChange={(mode) => {
          if (mode === "inherit") onChange(null);
          if (mode === "prefix") onChange({ mode: "prefix" });
          if (mode === "none") onChange({ mode: "none" });
        }}
      >
        <SelectTrigger aria-label="Branch naming mode">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {inheritedLabel !== undefined ? (
            <SelectItem value="inherit">Default ({inheritedLabel})</SelectItem>
          ) : null}
          <SelectItem value="prefix">Custom prefix</SelectItem>
          <SelectItem value="none">No prefix</SelectItem>
        </SelectPopup>
      </Select>
    </div>
  );
}
