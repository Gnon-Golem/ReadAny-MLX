import { publicWebUrl } from "@readany/core/ai/research";
import type { CitationPart, WebCitationPart } from "@readany/core/types/message";
import { Linking } from "react-native";

export type ChatCitation = CitationPart | WebCitationPart;

export async function openWebCitation(source: WebCitationPart): Promise<void> {
  const url = publicWebUrl(source.url);
  if (!url) throw new Error("Invalid web citation URL");
  await Linking.openURL(url);
}
