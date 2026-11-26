import type { WebCitationPart } from "@readany/core/types/message";
import { Linking } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { openWebCitation } from "./research-citations";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(async () => undefined) } }));

const source: WebCitationPart = {
  type: "web_citation",
  id: "source-1",
  createdAt: 100,
  status: "completed",
  provider: "parallel",
  title: "Metal",
  url: "https://developer.apple.com/documentation/metal",
  excerpt: "GPU documentation.",
  retrievalMethod: "fetch",
  retrievedAt: "2026-11-21T00:00:00Z",
  citationIndex: 1,
};

describe("web citation opening", () => {
  it("opens the registered public HTTPS URL in the platform browser", async () => {
    await openWebCitation(source);
    expect(Linking.openURL).toHaveBeenCalledWith(source.url);
  });

  it("does not send unsafe URLs to the operating system", async () => {
    vi.mocked(Linking.openURL).mockClear();
    await expect(
      openWebCitation({ ...source, url: "https://router.local/private" }),
    ).rejects.toThrow();
    await expect(openWebCitation({ ...source, url: "file:///var/data" })).rejects.toThrow();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
