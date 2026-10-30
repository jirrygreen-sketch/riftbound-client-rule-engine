import { describe, expect, it } from "vitest";
import {
  buildCardNameIndex,
  projectedObjectCardName,
  resolveCardName
} from "../../src/full-product/v2/card-names";
import { OFFICIAL_TOKEN_NAMES, officialTokenName } from "../../src/full-product/v2/token-names";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2ProjectedObject } from "../../../../../packages/protocol/src/v2/index.js";

// Official zh-CN gallery, accessed 2026-10-29:
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// Evidence used by the mapping:
// - Recruit: ogn-211-298 English "Recruit unit token" ↔ 忠实的工坊主
//   "一名1:rb_might:的“随从”".
// - Sand Soldier: sfd-157-221 English "Sand Soldier unit token" ↔ 皇家守卫
//   "一名2:rb_might:的“黄沙士兵”".
// - Mech / Gold / the other supported token names are cited beside their map
//   entries in token-names.ts from the same official gallery response.
// Timeline: 10-29 RIFT-1151 found the English fallback; 10-30 the parent
// verified the live catalog; the user required a same-day fix; RIFT-1153 added
// the display fallback.

const officialSource = {
  url: "https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN",
  locale: "zh-CN",
  updatedAt: "2026-10-29T23:31:13.358Z",
  syncedAt: "2026-10-29T23:31:13.358Z"
} as const;

function card(
  id: string,
  name: string,
  localizedName: string | undefined,
  canonicalCardId: string
): CatalogCard {
  return {
    id,
    canonicalCardId,
    name,
    fullName: name,
    ...(localizedName === undefined ? {} : { localizedName }),
    cardType: "Unit",
    domains: [],
    tags: [],
    setCode: id.slice(0, 3),
    cardNumber: id,
    variant: "standard",
    imageUrl: null,
    energy: null,
    power: null,
    might: 1,
    ability: "",
    localizedAbilityStatus: localizedName === undefined ? "english-fallback" : "official-structured",
    localizedAbilityLanguage: localizedName === undefined ? "en-US" : "zh-CN",
    localizedAbilitySource: officialSource
  };
}

function token(objectId: string, name: string, cardId?: string): V2ProjectedObject {
  return {
    objectId,
    zone: "board",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    ...(cardId === undefined ? {} : { cardId }),
    name,
    faceDown: false,
    visibility: "public",
    might: 1,
    location: { kind: "base", playerId: "alice" }
  };
}

describe("RIFT-1153 official Chinese token names", () => {
  it("maps Recruit variants and Sand Soldier only from attested official text", () => {
    expect(OFFICIAL_TOKEN_NAMES.Recruit).toBe("随从");
    expect(OFFICIAL_TOKEN_NAMES["Recruit (DE)"]).toBe("随从");
    expect(OFFICIAL_TOKEN_NAMES["Recruit (NX)"]).toBe("随从");
    expect(OFFICIAL_TOKEN_NAMES["Recruit (ZN)"]).toBe("随从");
    expect(OFFICIAL_TOKEN_NAMES["Sand Soldier"]).toBe("黄沙士兵");
    expect(officialTokenName("Recruit")).toBe("随从");
    expect(officialTokenName("Recruit (DE)")).toBe("随从");
    expect(officialTokenName("Sand Soldier")).toBe("黄沙士兵");
  });

  it("renders mapped effect-created tokens through the shared projected-name resolver", () => {
    const index = buildCardNameIndex([]);
    expect(projectedObjectCardName(index, token("recruit-1", "Recruit"))).toBe("随从");
    expect(projectedObjectCardName(index, token("recruit-de-1", "Recruit (DE)"))).toBe("随从");
    expect(projectedObjectCardName(index, token("sand-1", "Sand Soldier"))).toBe("黄沙士兵");
  });

  it("returns an unlisted English token name unchanged", () => {
    const index = buildCardNameIndex([]);
    expect(projectedObjectCardName(index, token("unknown-token", "Unlisted Token")))
      .toBe("Unlisted Token");
    expect(officialTokenName("Unlisted Token")).toBeUndefined();
    expect(projectedObjectCardName(index, token("listed-but-identified", "Recruit", "recruit-card")))
      .toBe("Recruit");
  });

  it("leaves ordinary cards with official Chinese names on their catalog resolution", () => {
    const cards = [card("card-recruit", "Recruit", "招募员", "canonical-recruit")];
    const index = buildCardNameIndex(cards);
    expect(resolveCardName(index, { cardId: "card-recruit", englishName: "Recruit" }))
      .toBe("招募员");
    expect(projectedObjectCardName(index, token("card-recruit-token", "Recruit", "card-recruit")))
      .toBe("招募员");
  });

  it("does not treat an English display label as official Chinese catalog data", () => {
    const index = buildCardNameIndex([
      card("sfd-233-star-221", "Yone", "Yone, Blademaster", "canonical-yone"),
      card("sfd-233-221", "Yone", "永恩", "canonical-yone")
    ]);
    expect(resolveCardName(index, {
      cardId: "sfd-233-star-221",
      englishName: "Yone"
    })).toBe("永恩");
    expect(resolveCardName(buildCardNameIndex([
      card("sfd-233-star-221", "Yone", "Yone, Blademaster", "canonical-yone")
    ]), { cardId: "sfd-233-star-221", englishName: "Yone" })).toBe("Yone");
  });
});
