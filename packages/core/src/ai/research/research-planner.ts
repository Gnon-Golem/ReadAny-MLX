import type { ResearchCache } from "./research-cache";
import { type WebSearchProvider, publicWebUrl } from "./web-provider";

export type WebResearchMode = "off" | "auto" | "always";
export type ResearchSource = "local" | "web" | "hybrid";

export interface ResearchOptions {
  mode: WebResearchMode;
  provider?: WebSearchProvider;
  createProvider?: () => WebSearchProvider;
  cache?: ResearchCache;
}

const EXTERNAL =
  /联网|聯網|网上|網上|互联网|網際網路|外部资料|外部來源|查网页|查網頁|\b(?:web|online|internet|sources?|papers?|studies|research)\b|(?:最新|近期|近年|当下|截至|截止|\b(?:recent|latest|current)\b).{0,30}(?:研究|论文|論文|资讯|資料|状态|消息|research|papers?|stud(?:y|ies)|news|information)|\b20\d{2}\b.{0,25}(?:研究|论文|論文|research|papers?)/iu;
const READING =
  /这(?:段|句|页|章|本)|這(?:段|句|頁|章|本)|本文|书中|書中|书库|書庫|选中|選中|第[\d一二三四五六七八九十百]+[章节章節]|\b(?:the book|across books|this (?:chapter|passage|paragraph|page|selection)|chapter\s*\d+)\b/iu;
const CASUAL =
  /^(?:你好|您好|谢谢|感謝|早上好|晚上好|hi|hello|hey|thanks|thank you)[！!？?.\s]*$/iu;
const PRIVATE =
  /(?:我的|私人|隐私|私密|我的筆記|我的笔记|账号|賬號|密码|密碼|笔记全文|筆記全文|my (?:private|notes?|password|account|highlights?)|api[_ -]?key|password|bearer\s+\S+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/iu;
const PLOT = /剧情|劇情|情节|情節|结局|結局|剧透|劇透|\b(?:plot|ending|spoilers?)\b/iu;

export function publicQuestion(userInput: string): string {
  return userInput
    .split(/\r?\n/)
    .filter((line) => !/^\s*>|^\s*关于以下文本[：:]/u.test(line))
    .join(" ")
    .trim();
}

export function researchSource(
  input: string,
  context: {
    mode: WebResearchMode;
    hasBook: boolean;
    libraryReference?: boolean;
    readingReference: boolean;
    spoilerFree?: boolean;
  },
): ResearchSource {
  const question = publicQuestion(input);
  const autoBookResearch = context.mode === "auto" && context.hasBook;
  const hasLocalScope = context.hasBook || context.libraryReference;
  if (
    context.mode === "off" ||
    !/[\p{L}\p{N}]/u.test(question) ||
    CASUAL.test(question) ||
    PRIVATE.test(question) ||
    (context.spoilerFree &&
      hasLocalScope &&
      (autoBookResearch ||
        context.readingReference ||
        READING.test(question) ||
        PLOT.test(question)))
  ) {
    return "local";
  }
  // In book chat, "hybrid" exposes both sources. The agent decides which to use.
  if (autoBookResearch) return "hybrid";
  if (context.mode === "auto" && !EXTERNAL.test(question) && !question.includes("https://")) {
    return "local";
  }
  return hasLocalScope && (context.readingReference || READING.test(question)) ? "hybrid" : "web";
}

export function publicSearchQuery(
  candidate: string,
  privateTexts: readonly string[],
): string | undefined {
  const query = candidate
    .normalize("NFKC")
    .trim()
    .replace(/(?:“[^”]{8,}”|「[^」]{8,}」|"[^"]{8,}")/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 2 || query.length > 160 || PRIVATE.test(query) || query.includes("https://")) {
    return;
  }
  const normalized = query.toLocaleLowerCase();
  for (const excerpt of privateTexts) {
    const text = excerpt.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    for (let i = 0; i + 24 <= normalized.length; i += 1) {
      if (text.includes(normalized.slice(i, i + 24))) return;
    }
    if (text.length >= 12 && normalized.includes(text)) return;
  }
  return query;
}

export function explicitWebUrls(question: string): string[] {
  return Array.from(question.matchAll(/https:\/\/[^\s<>()\[\]"'，。！？]+/giu))
    .map(([url]) => publicWebUrl(url.replace(/[.,;!?]+$/, "")))
    .filter((url): url is string => Boolean(url));
}
