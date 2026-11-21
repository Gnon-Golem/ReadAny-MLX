import { WebResearchError, type WebSource } from "@readany/core/ai/research";
import { File, Paths } from "expo-file-system";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Button, ScrollView, StyleSheet, Text, View } from "react-native";
import { createExpoWebSearchProvider } from "../lib/platform/expo-web-search";

const provider = createExpoWebSearchProvider();
const SAMPLE = "Find the official Apple Metal framework documentation.";
const SAMPLE_URL = "https://developer.apple.com/documentation/metal";

function errorStatus(error: unknown): string {
  return error instanceof WebResearchError ? `${error.code}: ${error.message}` : "Probe failed";
}

export default function ParallelProbe() {
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Ready");
  const [sources, setSources] = useState<WebSource[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") active.current?.abort();
    });
    return () => {
      sub.remove();
      active.current?.abort();
    };
  }, []);

  const runChecks = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStatus("Running anonymous search and source read");
    const startedAt = Date.now();
    const result: Record<string, unknown> = { startedAt };
    try {
      const options = { signal: controller.signal };
      const sources = await provider.search({ query: SAMPLE, limit: 3 }, options);
      result.search = sources.map(({ title, url, excerpt }) => ({
        title,
        url,
        excerptLength: excerpt.length,
      }));
      setSources(sources);
      const fetched = await provider.fetchPage(SAMPLE_URL, options);
      result.fetch = fetched && {
        title: fetched.title,
        url: fetched.url,
        excerptLength: fetched.excerpt.length,
      };
      setStatus(
        sources.length && fetched
          ? "Search and source read passed"
          : "Search or source read returned no results",
      );
    } catch (error) {
      result.error = errorStatus(error);
      if (error instanceof WebResearchError && error.retryAfter) {
        result.retryAfter = error.retryAfter;
      }
      setStatus(errorStatus(error));
    } finally {
      result.durationMs = Date.now() - startedAt;
      const file = new File(Paths.document, "parallel-probe-result.json");
      try {
        file.write(JSON.stringify(result));
      } catch {
        setStatus("Could not write probe report");
      }
      active.current = null;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  async function run(method: "search" | "fetch") {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStatus(method === "search" ? "Searching Parallel" : "Reading source with Parallel");

    try {
      if (method === "search") {
        const results = await provider.search(
          { query: SAMPLE, limit: 3 },
          { signal: controller.signal },
        );
        setSources(results);
        setStatus(results.length ? `Search returned ${results.length} sources` : "No sources");
      } else {
        const source = await provider.fetchPage(sources[0]?.url ?? SAMPLE_URL, {
          signal: controller.signal,
        });
        setSources(source ? [source] : []);
        setStatus(source ? "Source fetched" : "No excerpt for this source");
      }
    } catch (error) {
      setStatus(
        error instanceof WebResearchError ? `${error.code}: ${error.message}` : "Probe failed",
      );
    } finally {
      active.current = null;
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Parallel on iOS</Text>
      <View style={styles.actions}>
        <Button title="Run and save checks" disabled={busy} onPress={() => void runChecks()} />
        <Button
          title="Search Apple Metal docs"
          disabled={busy}
          onPress={() => void run("search")}
        />
        <Button title="Fetch first source" disabled={busy} onPress={() => void run("fetch")} />
        <Button title="Cancel" disabled={!busy} onPress={() => active.current?.abort()} />
      </View>
      <Text accessibilityLiveRegion="polite" selectable>
        {status}
      </Text>
      {sources.map((source) => (
        <View key={source.url} style={styles.source}>
          <Text selectable style={styles.title}>
            {source.title}
          </Text>
          <Text selectable>{source.url}</Text>
          <Text selectable>{source.excerpt}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 32, paddingTop: 72, gap: 16, backgroundColor: "#fff" },
  heading: { fontSize: 26, fontWeight: "600" },
  actions: { alignItems: "flex-start", gap: 8 },
  source: { gap: 6 },
  title: { fontWeight: "600" },
});
