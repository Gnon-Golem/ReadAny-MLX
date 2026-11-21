import { publicWebUrl } from "../ai/research/web-provider";
import type { WebCitationSource } from "../types/message";

export function formatWebSourceLink(source: Pick<WebCitationSource, "url" | "title">): string {
  const url = publicWebUrl(source.url);
  if (!url) return "";
  const label = source.title
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\[\]<>]/g, "\\$&");
  return `[${label || new URL(url).hostname}](<${url}>)`;
}

export function formatSourceExcerpt(excerpt: string): string {
  return excerpt
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\[\]<>]/g, "\\$&");
}
