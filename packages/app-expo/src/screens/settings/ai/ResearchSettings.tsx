import { useSettingsStore } from "@/stores/settings-store";
import { fontSize, fontWeight, radius, spacing, useColors, withOpacity } from "@/styles/theme";
import {
  MAX_CITATION_SOURCES,
  RESEARCH_TOOL_LIMITS,
  type WebResearchMode,
} from "@readany/core/ai/research";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { makeStyles } from "./ai-settings-styles";

const MODES = ["off", "auto", "always"] as const satisfies readonly WebResearchMode[];

export function ResearchSettings() {
  const colors = useColors();
  const settingsStyles = makeStyles(colors);
  const { t } = useTranslation();
  const mode = useSettingsStore((state) => state.webResearchMode);
  const setMode = useSettingsStore((state) => state.setWebResearchMode);
  const [showBudget, setShowBudget] = useState(false);
  const budget = RESEARCH_TOOL_LIMITS;

  return (
    <View style={settingsStyles.sectionCard}>
      <Text style={settingsStyles.sectionTitle}>{t("research.settingsTitle")}</Text>
      <Text style={[styles.details, { color: colors.mutedForeground }]}>
        {t("research.provider", { name: "Parallel" })}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.modes}>
        {MODES.map((choice) => {
          const selected = choice === mode;
          return (
            <Pressable
              key={choice}
              testID={`web-research-mode-${choice}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setMode(choice)}
              style={[
                styles.mode,
                { borderColor: selected ? colors.primary : colors.border },
                selected && { backgroundColor: withOpacity(colors.primary, 0.12) },
              ]}
            >
              <Text
                style={{
                  color: selected ? colors.primary : colors.foreground,
                  fontWeight: fontWeight.medium,
                }}
              >
                {t(`research.${choice}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.details, { color: colors.mutedForeground }]}>
        {t(`research.${mode}Description`)}
      </Text>
      <Text style={[styles.details, { color: colors.mutedForeground }]}>
        {t("research.privacy")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showBudget }}
        onPress={() => setShowBudget(!showBudget)}
        style={styles.advanced}
      >
        <Text style={{ color: colors.primary }}>
          {t("research.budget", { count: budget.total })}
        </Text>
      </Pressable>
      {showBudget && (
        <Text style={[styles.details, { color: colors.mutedForeground }]}>
          {t("research.budgetDetails", {
            local: budget.local,
            chapter: budget.chapter,
            reference: budget.reference,
            search: budget.webSearch,
            fetch: budget.webFetch,
            sources: MAX_CITATION_SOURCES,
          })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  mode: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    justifyContent: "center",
  },
  details: { fontSize: fontSize.sm, lineHeight: 20 },
  advanced: { minHeight: 44, justifyContent: "center" },
});
