import { createElement, Fragment, type CSSProperties, type ReactNode } from "react";
import type { CatalogCard } from "../../net/CardCatalogClient";
import { DUEL_DOMAIN_LABELS } from "./duel-board-model";

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
  /** The only accessible/tooltip text. A token without official Chinese prose
   * uses the literal API token rather than an invented Chinese label. */
  readonly title: string;
  /** A neutral, non-language glyph; it never stands for a rules command. */
  readonly glyph: string;
  readonly shape: "circle" | "square";
}

export const CARD_TEXT_TOKEN_MAP: Readonly<
  Record<CardTextToken, CardTextTokenPresentation>
> = Object.freeze({
  // Official evidence checked 2026-10-28:
  // - Six domain labels: official zh_CN card gallery
  //   https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
  //   (`DUEL_DOMAIN_LABELS` mirrors the official faction names; e.g.
  //   `ogn-001-298`, `sfd-001-221`, `rad-004-167`, `ven-040-166`).
  // - `:rb_might:`: official zh_CN text on `rad-004-167` and `sfd-026-221`
  //   says “每点强攻便提供:rb_might:+1”; “战力” is its text counterpart.
  // - `:rb_exhaust:`: official zh_CN text on `ven-075-166` and `unl-136-219`
  //   says “此牌以休眠状态进场”; “休眠” is the official prose counterpart.
  // - Energy and rainbow tokens have no observed official prose name: use a
  //   neutral glyph whose accessible title is the unaltered API token.
  ":rb_energy_0:": { glyph: "0", title: ":rb_energy_0:", shape: "circle" },
  ":rb_energy_1:": { glyph: "1", title: ":rb_energy_1:", shape: "circle" },
  ":rb_energy_2:": { glyph: "2", title: ":rb_energy_2:", shape: "circle" },
  ":rb_energy_3:": { glyph: "3", title: ":rb_energy_3:", shape: "circle" },
  ":rb_energy_4:": { glyph: "4", title: ":rb_energy_4:", shape: "circle" },
  ":rb_energy_5:": { glyph: "5", title: ":rb_energy_5:", shape: "circle" },
  ":rb_energy_6:": { glyph: "6", title: ":rb_energy_6:", shape: "circle" },
  ":rb_energy_7:": { glyph: "7", title: ":rb_energy_7:", shape: "circle" },
  ":rb_energy_8:": { glyph: "8", title: ":rb_energy_8:", shape: "circle" },
  ":rb_might:": { glyph: "⚔", title: "战力（:rb_might:）", shape: "square" },
  ":rb_exhaust:": { glyph: "↶", title: "休眠（:rb_exhaust:）", shape: "square" },
  ":rb_rune_fury:": {
    glyph: DUEL_DOMAIN_LABELS.Fury,
    title: DUEL_DOMAIN_LABELS.Fury,
    shape: "square"
  },
  ":rb_rune_calm:": {
    glyph: DUEL_DOMAIN_LABELS.Calm,
    title: DUEL_DOMAIN_LABELS.Calm,
    shape: "square"
  },
  ":rb_rune_mind:": {
    glyph: DUEL_DOMAIN_LABELS.Mind,
    title: DUEL_DOMAIN_LABELS.Mind,
    shape: "square"
  },
  ":rb_rune_body:": {
    glyph: DUEL_DOMAIN_LABELS.Body,
    title: DUEL_DOMAIN_LABELS.Body,
    shape: "square"
  },
  ":rb_rune_chaos:": {
    glyph: DUEL_DOMAIN_LABELS.Chaos,
    title: DUEL_DOMAIN_LABELS.Chaos,
    shape: "square"
  },
  ":rb_rune_order:": {
    glyph: DUEL_DOMAIN_LABELS.Order,
    title: DUEL_DOMAIN_LABELS.Order,
    shape: "square"
  },
  ":rb_rune_rainbow:": {
    glyph: "◆",
    title: ":rb_rune_rainbow:",
    shape: "square"
  }
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

const tokenBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.15em",
  minHeight: "1.15em",
  marginInline: "0.08em",
  paddingInline: "0.2em",
  border: "1px solid currentColor",
  color: "#efc862",
  fontSize: "0.82em",
  fontWeight: 700,
  lineHeight: 1,
  verticalAlign: "0.08em"
};

const circleTokenStyle: CSSProperties = {
  ...tokenBaseStyle,
  borderRadius: "50%"
};

const squareTokenStyle: CSSProperties = {
  ...tokenBaseStyle,
  borderRadius: "0.28em"
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
          data-token-shape={presentation.shape}
          aria-label={presentation.title}
          title={presentation.title}
          style={presentation.shape === "circle"
            ? circleTokenStyle
            : squareTokenStyle}
        >
          {presentation.glyph}
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
