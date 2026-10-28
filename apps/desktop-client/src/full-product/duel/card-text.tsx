import { createElement, Fragment, type CSSProperties, type ReactNode } from "react";
import type { CatalogCard } from "../../net/CardCatalogClient";

export const CARD_TEXT_TOKEN_MAP_VERSION = "riftbound.card-text-tokens.v1";

export const CARD_TEXT_ALLOWED_TAGS = [
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em"
] as const;

type AllowedTag = (typeof CARD_TEXT_ALLOWED_TAGS)[number];

export type CardTextToken =
  | ":rb_energy_0:"
  | ":rb_energy_1:"
  | ":rb_energy_2:"
  | ":rb_energy_3:"
  | ":rb_energy_4:"
  | ":rb_energy_5:"
  | ":rb_energy_6:"
  | ":rb_energy_7:"
  | ":rb_energy_8:"
  | ":rb_might:"
  | ":rb_exhaust:"
  | ":rb_rune_fury:"
  | ":rb_rune_calm:"
  | ":rb_rune_mind:"
  | ":rb_rune_body:"
  | ":rb_rune_chaos:"
  | ":rb_rune_order:"
  | ":rb_rune_rainbow:";

export interface CardTextTokenPresentation {
  readonly text: string;
  readonly label: string;
}

export const CARD_TEXT_TOKEN_MAP: Readonly<
  Record<CardTextToken, CardTextTokenPresentation>
> = Object.freeze({
  ":rb_energy_0:": { text: "0", label: "0 点能量" },
  ":rb_energy_1:": { text: "1", label: "1 点能量" },
  ":rb_energy_2:": { text: "2", label: "2 点能量" },
  ":rb_energy_3:": { text: "3", label: "3 点能量" },
  ":rb_energy_4:": { text: "4", label: "4 点能量" },
  ":rb_energy_5:": { text: "5", label: "5 点能量" },
  ":rb_energy_6:": { text: "6", label: "6 点能量" },
  ":rb_energy_7:": { text: "7", label: "7 点能量" },
  ":rb_energy_8:": { text: "8", label: "8 点能量" },
  ":rb_might:": { text: "战力", label: "战力符号" },
  ":rb_exhaust:": { text: "休眠", label: "休眠符号" },
  ":rb_rune_fury:": { text: "狂怒", label: "狂怒域符能" },
  ":rb_rune_calm:": { text: "平静", label: "平静域符能" },
  ":rb_rune_mind:": { text: "心灵", label: "心灵域符能" },
  ":rb_rune_body:": { text: "躯体", label: "躯体域符能" },
  ":rb_rune_chaos:": { text: "混乱", label: "混乱域符能" },
  ":rb_rune_order:": { text: "秩序", label: "秩序域符能" },
  ":rb_rune_rainbow:": { text: "任意", label: "任意域符能" }
});

export type CardTextData = Pick<
  CatalogCard,
  | "ability"
  | "localizedAbilityRulesText"
  | "localizedAbilityEffectText"
  | "localizedAbilityLanguage"
  | "localizedAbilityStatus"
  | "localizedAbilitySource"
>;

export const ENGLISH_FALLBACK_NOTICE = "官方中文正文不可用，以下为英文";
export const MISSING_ZH_TEXT_NOTICE = "官方中文正文不可用";
export const NO_EFFECT_NOTICE = "此牌没有规则或效果文本";

const allowedTags = new Set<string>(CARD_TEXT_ALLOWED_TAGS);
const tokenPattern = /(:rb_[a-z0-9_]+:|\[[^\]\r\n]{1,100}\])/g;
const tagPattern = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([^<>]*)>/g;

const keywordStyle: CSSProperties = {
  color: "#77d8ce",
  fontWeight: 700
};

const tokenStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.15em",
  minHeight: "1.15em",
  marginInline: "0.08em",
  paddingInline: "0.2em",
  border: "1px solid currentColor",
  borderRadius: "0.28em",
  color: "#efc862",
  fontSize: "0.82em",
  fontWeight: 700,
  lineHeight: 1,
  verticalAlign: "0.08em"
};

const cardTextStyle: CSSProperties = {
  width: "100%",
  maxHeight: "36vh",
  overflow: "auto",
  textAlign: "left"
};

interface MarkupFrame {
  readonly tag: AllowedTag;
  readonly rawOpen: string;
  readonly children: ReactNode[];
}

export function CardText({ card }: { readonly card: CardTextData }) {
  const status = card.localizedAbilityStatus;
  const common = {
    className: "card-text",
    style: cardTextStyle,
    "data-card-text-token-map": CARD_TEXT_TOKEN_MAP_VERSION,
    "data-localized-status": status ?? "missing"
  };

  if (status === "english-fallback") {
    return (
      <section {...common} aria-label="卡牌英文回退文本">
        <p className="card-text-fallback" role="note">{ENGLISH_FALLBACK_NOTICE}</p>
        {renderTextSection("规则文本", card.ability || undefined)}
        {renderTextSection("效果文本", undefined)}
      </section>
    );
  }

  if (status === "no-effect") {
    return (
      <section {...common} aria-label="卡牌无效果文本">
        <p className="card-text-no-effect">{NO_EFFECT_NOTICE}</p>
      </section>
    );
  }

  if (status !== "official-structured" &&
      status !== "official-accessibility-supplemented") {
    return (
      <section {...common} aria-label="官方中文正文缺失">
        <p className="card-text-missing">{MISSING_ZH_TEXT_NOTICE}</p>
      </section>
    );
  }

  return (
    <section {...common} aria-label="官方中文卡牌文本">
      {renderTextSection("规则文本", card.localizedAbilityRulesText)}
      {renderTextSection("效果文本", card.localizedAbilityEffectText)}
    </section>
  );
}

function renderTextSection(label: string, html: string | undefined): ReactNode {
  return (
    <div className="card-text-section">
      <h4>{label}</h4>
      {html ? parseRichText(html) : <p className="card-text-empty">无</p>}
    </div>
  );
}

/**
 * Renders the official HTML subset without handing markup to the browser.
 * Unknown tags are kept as literal text. Known tags lose all input attributes,
 * so display data cannot supply URLs, event handlers, or executable content.
 */
export function parseRichText(html: string): ReactNode {
  const root: ReactNode[] = [];
  const stack: MarkupFrame[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  tagPattern.lastIndex = 0;

  const append = (node: ReactNode): void => {
    const current = stack.at(-1);
    if (current) current.children.push(node);
    else root.push(node);
  };

  while ((match = tagPattern.exec(html)) !== null) {
    if (match.index > cursor) {
      append(renderInlineText(html.slice(cursor, match.index)));
    }

    const raw = match[0];
    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLocaleLowerCase();
    const tail = match[3] ?? "";
    const attributeFree = /^\s*\/?\s*$/.test(tail);
    const selfClosing = /\/\s*$/.test(tail);
    if (!allowedTags.has(name) || !attributeFree) {
      append(raw);
      cursor = tagPattern.lastIndex;
      continue;
    }

    const tag = name as AllowedTag;
    if (tag === "br" && !closing) {
      append(createElement("br", { key: `br:${match.index}` }));
    } else if (tag === "br") {
      append(raw);
    } else if (closing) {
      const current = stack.at(-1);
      if (current?.tag === tag) {
        stack.pop();
        append(createElement(tag, { key: `${tag}:${match.index}` }, ...current.children));
      } else {
        append(raw);
      }
    } else if (!selfClosing) {
      stack.push({ tag, rawOpen: raw, children: [] });
    } else {
      append(raw);
    }

    cursor = tagPattern.lastIndex;
  }

  if (cursor < html.length) append(renderInlineText(html.slice(cursor)));

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const unbalanced = [frame.rawOpen, ...frame.children];
    append(createElement(Fragment, { key: `unclosed:${frame.tag}` }, ...unbalanced));
  }

  return createElement(Fragment, null, ...root);
}

function renderInlineText(raw: string): ReactNode {
  const text = decodeHtmlEntities(raw);
  const parts: ReactNode[] = [];
  let cursor = 0;
  tokenPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    const presentation = CARD_TEXT_TOKEN_MAP[token as CardTextToken];
    if (presentation) {
      parts.push(
        <span
          key={`token:${match.index}:${token}`}
          className="card-text-token"
          data-token={token}
          aria-label={presentation.label}
          title={presentation.label}
          style={tokenStyle}
        >
          {presentation.text}
        </span>
      );
    } else if (token.startsWith("[")) {
      parts.push(
        <span
          key={`keyword:${match.index}:${token}`}
          className="card-text-keyword"
          data-card-text-keyword
          style={keywordStyle}
        >
          {token}
        </span>
      );
    } else {
      parts.push(token);
    }
    cursor = tokenPattern.lastIndex;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return createElement(Fragment, null, ...parts);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) return safeCodePoint(Number.parseInt(decimal, 10), entity);
      if (hexadecimal) {
        return safeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      }
      const named = entity.slice(1, -1).toLocaleLowerCase();
      if (named === "amp") return "&";
      if (named === "lt") return "<";
      if (named === "gt") return ">";
      if (named === "quot") return '"';
      if (named === "apos") return "'";
      if (named === "nbsp") return "\u00a0";
      return entity;
    }
  );
}

function safeCodePoint(value: number, fallback: string): string {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}

/**
 * Only validated localization display fields contribute to card search.
 * Missing or fallback text retains the existing English search behavior.
 */
export function cardTextSearchValues(card: CardTextData): readonly string[] {
  if (card.localizedAbilityStatus === "official-structured" ||
      card.localizedAbilityStatus === "official-accessibility-supplemented") {
    return [
      card.localizedAbilityRulesText ?? "",
      card.localizedAbilityEffectText ?? ""
    ].filter(Boolean);
  }
  return [card.ability].filter(Boolean);
}
