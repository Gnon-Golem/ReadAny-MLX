import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@readany/core/utils";
import type { LucideIcon } from "lucide-react";

export const chatPickerTriggerClass =
  "flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors";
export const chatPickerMenuClass = "rounded-xl border bg-background p-1 shadow-lg";
export const chatPickerItemClass =
  "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors";
export const chatPickerSelectedClass = "bg-primary/10 text-primary";

interface Choice<Value extends string> {
  value: Value;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  destructive?: boolean;
}

export function ChatOptionPicker<Value extends string>({
  label,
  triggerClassName,
  value,
  choices,
  disabled,
  side = "bottom",
  onChange,
}: {
  label: string;
  triggerClassName?: string;
  value: Value;
  choices: readonly Choice<Value>[];
  disabled?: boolean;
  side?: "top" | "bottom";
  onChange: (value: Value) => void;
}) {
  const selected = choices.find((choice) => choice.value === value);
  const Icon = selected?.icon;
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const choice = choices.find((item) => item.value === next);
        if (choice && !choice.disabled) onChange(choice.value);
      }}
    >
      <SelectTrigger
        aria-label={label}
        title={selected?.label ?? label}
        className={cn(
          chatPickerTriggerClass,
          "h-auto w-auto min-w-0 shrink-0 justify-start border-border shadow-none hover:bg-muted hover:text-foreground [&>svg:last-child]:size-3 [&>svg:last-child]:shrink-0 [&>svg:last-child]:opacity-100",
          selected?.destructive &&
            "border-destructive/25 bg-destructive/10 text-destructive hover:text-destructive",
          triggerClassName,
        )}
      >
        {Icon && <Icon aria-hidden="true" className="size-3 shrink-0" />}
        <SelectValue>{selected?.label ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        side={side}
        align={side === "top" ? "start" : "end"}
        className={cn(
          chatPickerMenuClass,
          "min-w-[max(8rem,var(--radix-select-trigger-width))] p-0",
        )}
      >
        {choices.map(({ value: option, label: text, icon: ItemIcon, disabled, destructive }) => (
          <SelectItem
            key={option}
            value={option}
            disabled={disabled}
            textValue={text}
            className={cn(
              chatPickerItemClass,
              "pr-7 [&>span:first-child_svg]:size-3",
              option === value && chatPickerSelectedClass,
              destructive && "text-destructive focus:text-destructive",
            )}
          >
            <span className="flex items-center gap-2">
              {ItemIcon && <ItemIcon aria-hidden="true" className="size-3.5 shrink-0" />}
              {text}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
