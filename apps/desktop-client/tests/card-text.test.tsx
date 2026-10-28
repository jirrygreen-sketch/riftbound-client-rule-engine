import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it } from "vitest";
import {
  CARD_TEXT_ALLOWED_TAGS,
  CARD_TEXT_TOKEN_MAP,
  CARD_TEXT_TOKEN_MAP_VERSION,
  CardText,
  ENGLISH_FALLBACK_NOTICE,
  MISSING_ZH_TEXT_NOTICE,
  cardTextSearchValues,
  parseRichText,
  type CardTextData
} from "../src/full-product/duel/card-text";
import { CardArtPreviewContent } from "../src/components/CardArtPreview";
import { CardPreviewOverlay } from "../src/full-product/duel/DuelOverlays";

const source = {
  url: "https://content.example/riftbound_gallery_cards?locale=zh_CN",
  locale: "zh-CN" as const,
  updatedAt: "2026-10-28T14:49:37Z",
  syncedAt: "2026-10-28T15:00:00Z"
};

function card(overrides: Partial<CardTextData> = {}): CardTextData {
  return {
    ability: "When I attack, draw a card.",
    localizedAbilityRulesText: "<p>[急速]（你可以额外支付:rb_energy_1:和:rb_rune_fury:。）</p>",
    localizedAbilityEffectText: "<p>本回合内:rb_might:+2。</p>",
    localizedAbilityLanguage: "zh-CN",
    localizedAbilityStatus: "official-structured",
    localizedAbilitySource: source,
    ...overrides
  };
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe("CardText", () => {
  it("renders official rules and effect text as separate sections", () => {
    const html = render(createElement(CardText, { card: card() }));

    expect(html).toContain("规则文本");
    expect(html).toContain("效果文本");
    expect(html).toContain("[急速]");
    expect(html).toContain("本回合内");
    expect(html).toContain(`data-card-text-token-map="${CARD_TEXT_TOKEN_MAP_VERSION}"`);
    expect(html).toContain('data-localized-status="official-structured"');
  });

  it("renders the complete versioned 18-token display map", () => {
    const tokens = Object.keys(CARD_TEXT_TOKEN_MAP) as (keyof typeof CARD_TEXT_TOKEN_MAP)[];
    expect(tokens).toHaveLength(18);
    const html = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText: `<p>${tokens.join(" ")}</p>`,
        localizedAbilityEffectText: undefined
      })
    }));

    for (const token of tokens) {
      expect(html).toContain(`data-token="${token}"`);
      expect(html).toContain(CARD_TEXT_TOKEN_MAP[token].text);
    }
    const body = html.replace(/ data-token="[^"]*"/g, "");
    expect(body).not.toMatch(/:rb_[a-z0-9_]+:/);
  });

  it("renders approved structural tags and escapes attributed variants", () => {
    const html = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText:
          '<p>安全段落<strong>普通强调</strong></p><p class="bad" onclick="alert(1)"><strong style="color:red">属性强调</strong></p><br><em>斜体</em><ul><li>一</li></ul><ol><li>二</li></ol>',
        localizedAbilityEffectText: undefined
      })
    }));

    for (const tag of CARD_TEXT_ALLOWED_TAGS) {
      if (tag === "br") expect(html).toContain("<br/>");
      else if (tag !== "p" || html.includes("<p")) expect(html).toContain(`<${tag}`);
    }
    expect(html).toContain("&lt;p class=&quot;bad&quot; onclick=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;strong style=&quot;color:red&quot;&gt;");
    expect(html).toContain("<strong>普通强调</strong>");
  });

  it("escapes malicious and unsupported HTML while preserving evidence", () => {
    const html = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText:
          '<script>alert(1)</script><img src=x onerror="alert(2)"><p>安全</p><a href="javascript:alert(3)">链接</a>',
        localizedAbilityEffectText: undefined
      })
    }));

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a href");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).toContain("&lt;a href=&quot;javascript:alert(3)&quot;&gt;链接&lt;/a&gt;");
    expect(html).toContain("<p>安全</p>");
  });

  it("shows unknown tokens literally and decodes official entity notation", () => {
    const html = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText:
          "<p>[已强化][&gt;] :rb_unknown_9:&lt;b&gt;不是标签&lt;/b&gt;</p>",
        localizedAbilityEffectText: undefined
      })
    }));

    expect(html).toContain("[已强化]");
    expect(html).toContain("[&gt;]");
    expect(html).toContain(":rb_unknown_9:");
    expect(html).toContain("&lt;b&gt;不是标签&lt;/b&gt;");
    expect(html).not.toContain('data-token=":rb_unknown_9:"');
  });

  it("keeps unbalanced allowed tags visible without trusting partial markup", () => {
    const html = render(parseRichText('<strong>开放式 <p>段落</br>'));
    expect(html).toContain("&lt;strong&gt;");
    expect(html).toContain("&lt;p&gt;");
    expect(html).toContain("&lt;/br&gt;");
    expect(html).toContain("开放式");
  });

  it("renders explicit English fallback and missing-state notices", () => {
    const fallback = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText: undefined,
        localizedAbilityEffectText: undefined,
        localizedAbilityLanguage: "en-US",
        localizedAbilityStatus: "english-fallback"
      })
    }));
    const missing = render(createElement(CardText, {
      card: card({
        localizedAbilityRulesText: undefined,
        localizedAbilityEffectText: undefined,
        localizedAbilityStatus: "missing"
      })
    }));

    expect(fallback).toContain(ENGLISH_FALLBACK_NOTICE);
    expect(fallback).toContain("When I attack, draw a card.");
    expect(fallback).toContain("效果文本");
    expect(missing).toContain(MISSING_ZH_TEXT_NOTICE);
    expect(missing).not.toContain("When I attack");
  });

  it("does not fabricate text when localization metadata is absent", () => {
    const html = render(createElement(CardText, { card: { ability: "Old English text." } }));
    expect(html).toContain(MISSING_ZH_TEXT_NOTICE);
    expect(html).not.toContain("Old English text.");
  });

  it("only exposes validated localized or explicit fallback text to search", () => {
    expect(cardTextSearchValues(card())).toEqual([
      card().localizedAbilityRulesText,
      card().localizedAbilityEffectText
    ]);
    expect(cardTextSearchValues(card({
      localizedAbilityStatus: "english-fallback",
      localizedAbilityRulesText: "不应检索",
      localizedAbilityEffectText: "也不应检索"
    }))).toEqual([card().ability]);
    expect(cardTextSearchValues({ ability: "English only" })).toEqual(["English only"]);
  });
});

describe("card text display locations", () => {
  it("renders card text below the large card art in CardArtPreview", () => {
    const html = render(createElement(CardArtPreviewContent, {
      imageUrl: "http://127.0.0.1/card.png",
      title: "灼焰飞龙",
      printingLabel: "普通版",
      cardText: card()
    }));

    expect(html).toContain("灼焰飞龙");
    expect(html.indexOf("card-art-frame")).toBeLessThan(html.indexOf("card-text"));
    expect(html).toContain("规则文本");
    expect(html).toContain("效果文本");
  });

  it("renders card text below the duel image when provided", () => {
    const html = render(createElement(CardPreviewOverlay, {
      cardId: "ogn-001-298",
      title: "灼焰飞龙",
      imageUrl: "http://127.0.0.1/card.png",
      cardText: card(),
      onClose: () => undefined
    }));

    expect(html.indexOf("full-product-duel-preview-image"))
      .toBeLessThan(html.indexOf("card-text"));
    expect(html).toContain("[急速]");
  });

  it("keeps duel preview markup unchanged when cardText is omitted", () => {
    const withoutText = render(createElement(CardPreviewOverlay, {
      cardId: "ogn-001-298",
      title: "Blazing Scorcher",
      imageUrl: null,
      onClose: () => undefined
    }));
    const withEmptyFragment = render(createElement(Fragment, null,
      createElement(CardPreviewOverlay, {
        cardId: "ogn-001-298",
        title: "Blazing Scorcher",
        imageUrl: null,
        onClose: () => undefined
      })
    ));

    expect(withoutText).toBe(withEmptyFragment);
    expect(withoutText).not.toContain("card-text");
  });
});
