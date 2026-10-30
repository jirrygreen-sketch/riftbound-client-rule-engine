import { describe, expect, it } from "vitest";
import {
  normalizeCardCatalog,
  type CatalogCard
} from "../card-catalog.js";
import { createGameServer, type GameServer } from "../server.js";

const YONE_CANONICAL = "card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56";
const YONE_ABILITY = "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\nWhen I conquer an open battlefield, deal damage equal to my Might to an enemy unit in a base.";
const YONE_CHINESE_ABILITY = "<p>[百炼]（当你打出我时，你可以选择为我[装配]你的一件武装，其装配费用减少:rb_rune_rainbow:。可选择已贴附的武装。）<br />当我征服一处开放战场时，对基地中的一名敌方单位造成等同于我战力的伤害。</p>";

function card(overrides: Partial<CatalogCard> & Pick<CatalogCard, "id" | "canonicalCardId" | "name" | "fullName">): CatalogCard {
  return {
    cardType: "Unit",
    domains: ["Body"],
    tags: [],
    setCode: overrides.id.slice(0, 3),
    cardNumber: overrides.id,
    variant: "standard",
    imageUrl: null,
    energy: 5,
    power: 1,
    might: 5,
    ability: YONE_ABILITY,
    ...overrides
  };
}

// Official zh-CN gallery, accessed 2026-10-29:
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// Timeline: 10-29 RIFT-1151 found the English fallback; 10-30 parent verified
// the live catalog; the user required the same-day fix; RIFT-1153 implements it.
const officialSource = {
  url: "https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN",
  locale: "zh-CN",
  updatedAt: "2026-10-29T23:31:13.358Z",
  syncedAt: "2026-10-29T23:31:13.358Z"
} as const;

function catalog(cards: readonly CatalogCard[]): unknown {
  return {
    schemaVersion: 1,
    dataVersion: "RIFT-1153-test",
    digest: `sha256:${"1".repeat(64)}`,
    cards
  };
}

describe("RIFT-1153 sibling localization", () => {
  it("localizes the alternate Yone printing from a complete official sibling and marks provenance", () => {
    const standard = card({
      id: "sfd-233-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "永恩",
      localizedSubtitle: "一剑封尘",
      localizedAbilityRulesText: YONE_CHINESE_ABILITY,
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    const alternate = card({
      id: "sfd-233-star-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "Yone, Blademaster",
      ability: YONE_ABILITY,
      localizedAbilityRulesText: YONE_ABILITY,
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback",
      localizedAbilitySource: officialSource,
      variant: "alternate",
      cardNumber: "SFD-233*/221"
    });
    const differentWording = card({
      id: "rad-181-167",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "永恩",
      localizedSubtitle: "一剑封尘",
      ability: "[Weaponmaster]\nWhen I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base.",
      localizedAbilityRulesText: "旧版不同效果文本",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource,
      setCode: "rad"
    });

    const publicCatalog = normalizeCardCatalog(catalog([differentWording, standard, alternate]));
    expect(publicCatalog.cards[2]).toMatchObject({
      id: "sfd-233-star-221",
      name: "Yone",
      ability: YONE_ABILITY,
      localizedName: "永恩",
      localizedSubtitle: "一剑封尘",
      localizedAbilityRulesText: YONE_CHINESE_ABILITY,
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured-sibling",
      localizedAbilitySource: officialSource,
      localizedFromPrintingId: "sfd-233-221"
    });
    expect(publicCatalog.cards[2]!.localizedAbilitySource)
      .not.toBe(standard.localizedAbilitySource);
    expect(JSON.parse(JSON.stringify(publicCatalog)).cards[2])
      .toMatchObject({ localizedFromPrintingId: "sfd-233-221" });
  });

  it("leaves an English-only card unchanged when no sibling has official Chinese localization", () => {
    const publicCatalog = normalizeCardCatalog(catalog([
      card({
        id: "sfd-154-221",
        canonicalCardId: "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44",
        name: "Guards!",
        fullName: "Guards!",
        localizedName: "Guards!",
        cardType: "Spell",
        ability: "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\nPlay a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it.",
        localizedAbilityLanguage: "en-US",
        localizedAbilityStatus: "english-fallback",
        localizedAbilitySource: officialSource
      })
    ]));

    expect(publicCatalog.cards[0]).toMatchObject({
      id: "sfd-154-221",
      localizedName: "Guards!",
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback"
    });
    expect(publicCatalog.cards[0]).not.toHaveProperty("localizedFromPrintingId");
    expect(publicCatalog.cards[0]).not.toHaveProperty("localizedSubtitle");
  });

  it("does not promote an English-only sibling into a Chinese source", () => {
    const alternate = card({
      id: "sfd-233-star-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "Yone, Blademaster",
      localizedAbilityRulesText: YONE_ABILITY,
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback",
      localizedAbilitySource: officialSource,
      variant: "alternate"
    });
    const standard = card({
      id: "sfd-233-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "Yone, Blademaster",
      localizedAbilityRulesText: YONE_ABILITY,
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback",
      localizedAbilitySource: officialSource
    });
    const output = normalizeCardCatalog(catalog([standard, alternate]));
    expect(output.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sfd-233-star-221", localizedName: "Yone, Blademaster" }),
      expect.objectContaining({ id: "sfd-233-221", localizedName: "Yone, Blademaster" })
    ]));
    expect(output.cards.some(value => value.localizedFromPrintingId !== undefined)).toBe(false);
  });

  it("does not treat an empty-effect card as an official Chinese source", () => {
    const blankStandard = card({
      id: "fixture-1",
      canonicalCardId: "fixture-canonical",
      name: "Fixture",
      fullName: "Fixture",
      ability: ""
    });
    const englishAlternate = card({
      id: "fixture-star",
      canonicalCardId: "fixture-canonical",
      name: "Fixture",
      fullName: "Fixture",
      localizedName: "Fixture",
      localizedAbilityStatus: "english-fallback",
      ability: "English-only effect"
    });
    const output = normalizeCardCatalog(catalog([blankStandard, englishAlternate]));
    expect(output.cards[1]).toMatchObject({
      id: "fixture-star",
      localizedName: "Fixture",
      localizedAbilityStatus: "english-fallback"
    });
    expect(output.cards[1]).not.toHaveProperty("localizedFromPrintingId");
  });

  it("does not reuse a source that was itself marked as a sibling fallback", () => {
    const chainedSource = card({
      id: "fixture-chained-source",
      canonicalCardId: "fixture-chain-canonical",
      name: "Fixture",
      fullName: "Fixture",
      localizedName: "夹具",
      localizedAbilityRulesText: "<p>官方中文效果</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource,
      localizedFromPrintingId: "fixture-original-source"
    });
    const target = card({
      id: "fixture-target",
      canonicalCardId: "fixture-chain-canonical",
      name: "Fixture",
      fullName: "Fixture",
      localizedName: "Fixture"
    });
    const output = normalizeCardCatalog(catalog([chainedSource, target]));
    expect(output.cards[1]).toMatchObject({ id: "fixture-target", localizedName: "Fixture" });
    expect(output.cards[1]).not.toHaveProperty("localizedFromPrintingId");
  });

  it("requires actual Chinese effect text before accepting an official source status", () => {
    const sourceWithoutText = card({
      id: "fixture-source-without-text",
      canonicalCardId: "fixture-source-text-canonical",
      name: "Fixture",
      fullName: "Fixture",
      localizedName: "夹具",
      localizedSubtitle: "副标题",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured"
    });
    const target = card({
      id: "fixture-target-without-text",
      canonicalCardId: "fixture-source-text-canonical",
      name: "Fixture",
      fullName: "Fixture",
      localizedName: "Fixture"
    });
    const output = normalizeCardCatalog(catalog([sourceWithoutText, target]));
    expect(output.cards[1]).toMatchObject({
      id: "fixture-target-without-text",
      localizedName: "夹具",
      localizedFromPrintingId: "fixture-source-without-text"
    });
    expect(output.cards[1]).not.toHaveProperty("localizedAbilityStatus");
    expect(output.cards[1]).not.toHaveProperty("localizedAbilityRulesText");
  });
});

describe("RIFT-1153 HTTP projection", () => {
  it("serves the sibling provenance through the real HTTP route", async () => {
    const standard = card({
      id: "sfd-233-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "永恩",
      localizedSubtitle: "一剑封尘",
      localizedAbilityRulesText: YONE_CHINESE_ABILITY,
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    const alternate = card({
      id: "sfd-233-star-221",
      canonicalCardId: YONE_CANONICAL,
      name: "Yone",
      subtitle: "Blademaster",
      fullName: "Yone, Blademaster",
      localizedName: "Yone, Blademaster",
      variant: "alternate",
      cardNumber: "SFD-233*/221"
    });
    let server: GameServer | null = null;
    try {
      server = createGameServer({
        host: "127.0.0.1",
        port: Number(process.env.SWARM_PORT_BASE ?? 38600),
        catalog: catalog([standard, alternate])
      });
      await server.start();
      const address = server.httpServer.address();
      if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/cards`);
      expect(response.status).toBe(200);
      const httpCatalog = await response.json() as {
        cards: readonly {
          id: string;
          localizedName?: string;
          localizedSubtitle?: string;
          localizedAbilityStatus?: string;
          localizedFromPrintingId?: string;
        }[];
      };
      expect(httpCatalog.cards.find(value => value.id === "sfd-233-star-221")).toMatchObject({
        localizedAbilityStatus: "official-structured-sibling",
        localizedFromPrintingId: "sfd-233-221"
      });
      expect(httpCatalog.cards.find(value => value.id === "sfd-233-star-221")).toMatchObject({
        localizedName: "永恩",
        localizedSubtitle: "一剑封尘"
      });
    } finally {
      await server?.stop();
    }
  });
});
