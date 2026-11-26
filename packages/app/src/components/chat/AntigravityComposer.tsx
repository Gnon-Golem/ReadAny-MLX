import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AntigravityContextUsage } from "@/lib/agents/antigravity-context-usage";
import type { AgentConfigOption } from "@/lib/agents/desktop-runtime";
import { cn } from "@readany/core/utils";
import { Check, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const chatPill =
  "flex min-w-0 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";

const effortKeys = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "extraHigh",
} as const;

export function AntigravityModelControl({
  options,
  disabled,
  connecting,
  onConnect,
  onChange,
}: {
  options?: AgentConfigOption[];
  disabled: boolean;
  connecting: boolean;
  onConnect: () => void;
  onChange: (id: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const [chooseModel, setChooseModel] = useState(false);
  const drag = useRef(false);
  const [draft, setDraft] = useState<number>();
  const model = options?.find(({ id }) => id === "model");
  const effort = options?.find(({ id }) => id === "thought_level");
  const chosen = model?.options.find(({ value }) => value === model.currentValue);
  const current = effort?.options.findIndex(({ value }) => value === effort.currentValue) ?? -1;
  const step = effort ? effort.options[draft ?? current] : undefined;
  const effortLabel = (choice: { value: string; label: string }) => {
    const key = effortKeys[choice.value as keyof typeof effortKeys];
    return key ? t(`chat.antigravityEffort.${key}`) : choice.label;
  };
  function applyEffort(index: number) {
    const option = effort?.options[index];
    setDraft(undefined);
    if (effort && option && option.value !== effort.currentValue) onChange(effort.id, option.value);
  }

  return (
    <Popover
      onOpenChange={(open) => {
        setChooseModel(false);
        setDraft(undefined);
        drag.current = false;
        if (open && !model) onConnect();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(chatPill, "max-w-full shrink")}
          title={chosen?.label}
          disabled={disabled}
          aria-label={t("chat.antigravityModelEffort")}
        >
          <span className="truncate">
            {connecting
              ? t("chat.antigravityConnecting")
              : (chosen?.label ?? t("chat.antigravityModelEffort"))}
          </span>
          {step && <span className="shrink-0">{effortLabel(step)}</span>}
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)] rounded-2xl p-3"
      >
        {!model ? (
          <output className="text-xs text-muted-foreground">
            {disabled ? t("chat.antigravityConnecting") : t("chat.antigravityOptionsUnavailable")}
          </output>
        ) : chooseModel ? (
          <>
            <button
              type="button"
              className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"
              onClick={() => setChooseModel(false)}
            >
              <ChevronLeft className="size-3" />
              {t("chat.antigravityModels")}
            </button>
            <div className="max-h-52 overflow-auto">
              {model.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={model.currentValue === option.value}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted ${model.currentValue === option.value ? "bg-primary/10 text-primary" : ""}`}
                  onClick={() => {
                    setChooseModel(false);
                    if (model.currentValue !== option.value) onChange(model.id, option.value);
                  }}
                >
                  <span>{option.label}</span>
                  {model.currentValue === option.value && <Check className="size-3 shrink-0" />}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {step && (
              <div className="relative text-center">
                <SlidersHorizontal className="absolute left-1 top-1 size-4 text-muted-foreground" />
                <output className="text-base font-semibold text-primary">
                  {effortLabel(step)}
                </output>
              </div>
            )}
            <button
              type="button"
              className="mx-auto flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              onClick={() => setChooseModel(true)}
            >
              {chosen?.label ?? t("chat.antigravityModels")}
              <ChevronRight className="size-3" />
            </button>
            {effort && effort.options.length > 1 && (
              <div className="mt-2">
                <input
                  type="range"
                  min={0}
                  max={effort.options.length - 1}
                  step={1}
                  value={draft ?? Math.max(0, current)}
                  disabled={disabled}
                  aria-label={t("chat.antigravityThinking")}
                  aria-valuetext={step ? effortLabel(step) : undefined}
                  className="my-1 block h-3 w-full appearance-none rounded-full bg-muted accent-primary [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background"
                  style={{
                    background: `linear-gradient(to right, var(--primary) ${(100 * (draft ?? Math.max(0, current))) / (effort.options.length - 1)}%, var(--muted) 0)`,
                  }}
                  onPointerDown={() => {
                    drag.current = true;
                  }}
                  onPointerCancel={() => {
                    drag.current = false;
                    setDraft(undefined);
                  }}
                  onPointerUp={(event) => {
                    drag.current = false;
                    applyEffort(Number(event.currentTarget.value));
                  }}
                  onBlur={() => {
                    drag.current = false;
                    setDraft(undefined);
                  }}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (drag.current) setDraft(next);
                    else applyEffort(next);
                  }}
                />
                <div
                  className="mt-1 flex justify-between text-[10px] text-muted-foreground"
                  aria-hidden="true"
                >
                  {effort.options.map((option) => (
                    <span key={option.value}>{effortLabel(option)}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AntigravityContextControl({
  usage,
  cached,
  visibleConversation,
}: {
  usage?: AntigravityContextUsage;
  cached?: boolean;
  visibleConversation: { messages: number; characters: number };
}) {
  const { t, i18n } = useTranslation();
  const percent = usage ? Math.min(100, Math.round((100 * usage.used) / usage.size)) : 0;
  const tokens = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("chat.antigravityContext")}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeOpacity=".35"
              strokeWidth="2"
              strokeDasharray={usage ? undefined : "2 2"}
            />
            {percent > 0 && (
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray={`${percent} 100`}
                transform="rotate(-90 8 8)"
              />
            )}
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-max max-w-[calc(100vw-1rem)] rounded-xl border-0 bg-neutral-900 px-3 py-2 text-xs text-neutral-100"
      >
        <p className="mb-1 text-neutral-300">
          {t(cached ? "chat.antigravityContextLastReported" : "chat.antigravityContext")}
        </p>
        {usage ? (
          <>
            <p className="font-medium">
              {t("chat.antigravityContextPercent", { used: percent, remaining: 100 - percent })}
            </p>
            <p className="text-neutral-300">
              {t("chat.antigravityContextTokens", {
                used: tokens.format(usage.used),
                size: tokens.format(usage.size),
              })}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">
              {t("chat.antigravityContextVisibleText", {
                count: visibleConversation.messages,
                characters: tokens.format(visibleConversation.characters),
              })}
            </p>
            <p className="text-neutral-300">{t("chat.antigravityContextNoReport")}</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
