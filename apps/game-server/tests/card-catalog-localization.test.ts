import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CardCatalogClient } from "../../desktop-client/src/net/CardCatalogClient.js";
import {
  loadCardCatalogRuntime,
  normalizeCardCatalog
} from "../src/card-catalog.js";
import { toDuelCatalogEnvelope } from "../src/duel/card-program-authority.js";
import { createGameServer, type GameServer } from "../src/server.js";

const servers: GameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

const officialSource = {
  url: "https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN",
  locale: "zh-CN",
  updatedAt: "2026-10-28T14:49:37.893071677Z",
  syncedAt: "2026-10-28T14:53:17.000Z"
} as const;

// Public official text recorded in RIFT-1124's checked-in research report.
const blazingScorcher = {
  id: "ogn-001-298",
  canonicalCardId: "card.hash-0da93712208ccce43badde9998369ec8b785af649c804e812feb2bb580f2908c",
  name: "Blazing Scorcher",
  fullName: "Blazing Scorcher",
  localizedName: "灼焰飞龙",
  cardType: "Unit",
  domains: ["Fury"],
  tags: ["Dragon", "Noxus"],
  setCode: "ogn",
  cardNumber: "OGN-001/298",
  variant: "standard",
  imageUrl: null,
  energy: 5,
  power: null,
  might: 5,
  ability: "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
} as const;

const furyRune = {
  id: "ogn-007-298",
  canonicalCardId: "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902",
  name: "Fury Rune",
  fullName: "Fury Rune",
  localizedName: "炽烈符文",
  cardType: "Rune",
  domains: ["Fury"],
  tags: ["Basic"],
  setCode: "ogn",
  cardNumber: "OGN-007/298",
  variant: "standard",
  imageUrl: null,
  energy: null,
  power: null,
  might: null,
  ability: ""
} as const;

const againstTheOdds = {
  id: "sfd-001-221",
  canonicalCardId: "card.hash-ce4f294fc93a34896d001feda8ba9d15d051f2ea01bf0c84a56036243102b3fa",
  name: "Against the Odds",
  fullName: "Against the Odds",
  localizedName: "矢志不退",
  cardType: "Spell",
  domains: ["Fury"],
  tags: [],
  setCode: "sfd",
  cardNumber: "SFD-001/221",
  variant: "standard",
  imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4c4ab0c838854ccd5d5399a045835876450287e8-744x1039.png?accountingTag=RB",
  energy: 2,
  power: null,
  might: null,
  ability: "[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a friendly unit at a battlefield +2 :rb_might: this turn for each enemy unit there."
} as const;

const blightedBattleaxe = {
  id: "unl-019-219",
  canonicalCardId: "card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558",
  name: "Blighted Battleaxe",
  fullName: "Blighted Battleaxe",
  localizedName: "枯萎战斧",
  cardType: "Gear",
  domains: ["Fury"],
  tags: ["Equipment"],
  setCode: "unl",
  cardNumber: "UNL-019/219",
  variant: "standard",
  imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a6425462180dc6bc3396397cd491c0abae58f616-744x1039.png?accountingTag=RB",
  energy: 4,
  power: null,
  might: 4,
  ability: "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)"
} as const;

const brazenBuccaneer = {
  id: "ogn-002-298",
  canonicalCardId: "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc",
  name: "Brazen Buccaneer",
  fullName: "Brazen Buccaneer",
  localizedName: "粗鲁的海盗",
  cardType: "Unit",
  domains: ["Fury"],
  tags: ["Pirate", "Bilgewater"],
  setCode: "ogn",
  cardNumber: "OGN-002/298",
  variant: "standard",
  imageUrl: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d481971f7560e7235e7d6934767da18daa019eff-744x1039.png?accountingTag=RB",
  energy: 6,
  power: null,
  might: 5,
  ability: "As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:."
} as const;

const legacyCatalog = {
  schemaVersion: 1,
  dataVersion: "localization-legacy-schema-1",
  digest: "sha256:" + "1".repeat(64),
  cards: [
    {
      ...furyRune
    }
  ]
} as const;

const localizedCatalog = {
  ...legacyCatalog,
  dataVersion: "localization-schema-1",
  digest: "sha256:" + "2".repeat(64),
  cards: [
    {
      ...blazingScorcher,
      localizedAbilityRulesText: "<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    },
    {
      ...againstTheOdds,
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback"
    },
    {
      ...blightedBattleaxe,
      localizedAbilityEffectText: "<p>在你回合结束时，如果我本回合没有征服战场，则卸除此装备，并对我造成4点伤害。</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    },
    {
      ...brazenBuccaneer
    }
  ]
} as const;

describe("Chinese card catalog projection", () => {
  it("accepts all five optional fields and forwards them without changing the English authority text or printed costs", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: localizedCatalog,
      imagesDirectory: await emptyImagesDirectory()
    });

    expect(runtime.publicCatalog.schemaVersion).toBe(1);
    expect(runtime.publicCatalog.cards[0]).toMatchObject({
      id: "ogn-001-298",
      ability: blazingScorcher.ability,
      energy: 5,
      power: null,
      localizedAbilityRulesText: "<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    expect(runtime.publicCatalog.cards[0]!.localizedAbilitySource)
      .not.toBe(localizedCatalog.cards[0].localizedAbilitySource);
    expect(runtime.publicCatalog.cards[2]).toMatchObject({
      id: "unl-019-219",
      ability: blightedBattleaxe.ability,
      localizedAbilityEffectText: "<p>在你回合结束时，如果我本回合没有征服战场，则卸除此装备，并对我造成4点伤害。</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    expect(JSON.parse(runtime.publicCatalogJson).cards[0]).toMatchObject({
      localizedAbilityRulesText: "<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）</p>",
      localizedAbilityStatus: "official-structured"
    });
  });

  it("keeps old catalogs and cards with omitted localization fields unchanged", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: legacyCatalog,
      imagesDirectory: await emptyImagesDirectory()
    });
    const card = runtime.publicCatalog.cards[0]!;

    expect(runtime.publicCatalog.schemaVersion).toBe(1);
    expect(card.ability).toBe("");
    expect(card.energy).toBeNull();
    expect(card.power).toBeNull();
    expect(card).not.toHaveProperty("localizedAbilityRulesText");
    expect(card).not.toHaveProperty("localizedAbilityEffectText");
    expect(card).not.toHaveProperty("localizedAbilityLanguage");
    expect(card).not.toHaveProperty("localizedAbilityStatus");
    expect(card).not.toHaveProperty("localizedAbilitySource");

    const mixed = await loadCardCatalogRuntime({
      catalog: localizedCatalog,
      imagesDirectory: await emptyImagesDirectory()
    });
    expect(mixed.publicCatalog.cards[3]).not.toHaveProperty("localizedAbilityStatus");
  });

  it.each([
    ["rules text is not a string", { localizedAbilityRulesText: 7 }],
    ["effect text is too long", { localizedAbilityEffectText: "x".repeat(4097) }],
    ["language is outside the contract", { localizedAbilityLanguage: "fr-FR" }],
    ["status is outside the contract", { localizedAbilityStatus: "machine-translated" }],
    ["source is null", { localizedAbilitySource: null }],
    ["source has an extra field", {
      localizedAbilitySource: { ...officialSource, privateHint: "not-public" }
    }],
    ["source locale is not Chinese", {
      localizedAbilitySource: { ...officialSource, locale: "en-US" }
    }],
    ["source URL is not HTTPS", {
      localizedAbilitySource: { ...officialSource, url: "http://publishing.riotgames.com/cards" }
    }],
    ["source update time is not UTC", {
      localizedAbilitySource: { ...officialSource, updatedAt: "2026-10-28" }
    }],
    ["source sync time is missing", {
      localizedAbilitySource: {
        url: officialSource.url,
        locale: officialSource.locale,
        updatedAt: officialSource.updatedAt
      }
    }]
  ])("rejects a card when %s", (_label, change) => {
    const card = { ...legacyCatalog.cards[0], ...change };
    expect(() => normalizeCardCatalog({ ...legacyCatalog, cards: [card] }))
      .toThrow("Card catalog entry 0 is invalid.");
  });

  it("keeps localization fields out of the private card program authority projection", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: localizedCatalog,
      imagesDirectory: await emptyImagesDirectory()
    });
    const privateCard = toDuelCatalogEnvelope(runtime.publicCatalog).cards[0]!;

    expect(privateCard).toMatchObject({
      ability: blazingScorcher.ability,
      energy: 5,
      power: null
    });
    expect(Object.keys(privateCard).filter(key => key.startsWith("localizedAbility")))
      .toEqual([]);
  });

  it("serves Chinese, English fallback, and missing metadata through the real HTTP route and schema 1 client", async () => {
    const { baseUrl } = await startServer(localizedCatalog);
    const response = await fetch(`${baseUrl}/api/cards`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.cards[0]).toMatchObject({
      ability: blazingScorcher.ability,
      energy: 5,
      power: null,
      localizedAbilityRulesText: "<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    expect(body.cards[1]).toMatchObject({
      id: "sfd-001-221",
      ability: againstTheOdds.ability,
      localizedAbilityLanguage: "en-US",
      localizedAbilityStatus: "english-fallback"
    });
    expect(body.cards[2]).toMatchObject({
      id: "unl-019-219",
      localizedAbilityEffectText: "<p>在你回合结束时，如果我本回合没有征服战场，则卸除此装备，并对我造成4点伤害。</p>",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityStatus: "official-structured",
      localizedAbilitySource: officialSource
    });
    expect(body.cards[3]).not.toHaveProperty("localizedAbilityRulesText");
    expect(body.cards[3]).not.toHaveProperty("localizedAbilityEffectText");
    expect(body.cards[3]).not.toHaveProperty("localizedAbilityStatus");

    const legacyClient = new CardCatalogClient({ fetchImpl: fetch });
    const clientCatalog = await legacyClient.loadCatalog(baseUrl);
    expect(clientCatalog.schemaVersion).toBe(1);
    expect(clientCatalog.cards).toHaveLength(4);
    expect(clientCatalog.cards[0]).toMatchObject({
      id: "ogn-001-298",
      ability: blazingScorcher.ability
    });
  });
});

async function startServer(catalog: unknown): Promise<{ baseUrl: string }> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: Number(process.env.SWARM_PORT_BASE ?? 36920),
    catalog,
    imagesDirectory: await emptyImagesDirectory(),
    constructedPolicy: { asOf: "2026-10-28T00:00:00.000Z" }
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("The card catalog test server did not expose a TCP address.");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function emptyImagesDirectory(): Promise<string> {
  const directory = path.join(
    tmpdir(),
    process.env.SWARM_TASK ?? "RIFT-1127-zh-text-server-catalog",
    `card-catalog-localization-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(directory, { recursive: true });
  return directory;
}
