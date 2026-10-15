/**
 * Self-contained, tracked unit fixture for `setup-seats.test.ts`.
 *
 * This is deliberately NOT official card data and NOT a claim about the real
 * 1,381-printing pool. It is a minimal representative subset:
 *
 * - the `cards` below are verbatim copies of the generated official deck-catalog
 *   entries for exactly the printings the two representative decks use. Keeping
 *   the real records (identity, `cardType`, `domains`, `tags`, `setCode`,
 *   `fullName`) means the real server `validateCatalogDeck` runs its genuine
 *   constructed policy — Domain Identity, Champion Legend tag/family resolution
 *   (CR 103.2.a.2 / 133.8.b) and Signature checks — without any fake validator,
 *   and the chosen champion's family still resolves through the same catalog
 *   `knownChampionTags` rule as production (`Vi` from `unl-176-219`).
 * - `catalog.groups` is omitted because the adapter never reads groups.
 * - `dataVersion`/`digest` are fixture-owned marker values; the real generated
 *   catalog is `2026-10-12-official-gallery` /
 *   `sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10`
 *   and is asserted only by the opt-in actual-catalog acceptance run, never here.
 *
 * Fresh-checkout/CI safety: nothing in this module (or in `setup-seats.test.ts`)
 * reads `outputs/coordination/**` or the gitignored `packages/card-data/data/*`
 * files, so the formal cases pass without any locally generated data.
 *
 * `digest` is the SHA-256 of the compact, key-sorted JSON of `cards`, so it is a
 * deterministic, self-describing fixture marker rather than an invented hash.
 */
import type { DeckSubmission } from "../../../src/deck-validation.js";

export interface SetupAdapterFixtureDeck {
  readonly id: string;
  readonly name: string;
  readonly submission: DeckSubmission;
}

/** Representative minimal runtime catalog (20 printings) for the adapter cases. */
export const setupAdapterFixtureCatalog = {
  schemaVersion: 1,
  dataVersion: "setup-adapter-unit-fixture-1",
  digest: "sha256:fe491dd8ba090f157626c84425d1f30ccda9e2624d4f76d89539624d242e2f2d",
  cards: [
    {
      "id": "ogn-001-298",
      "canonicalCardId": "card.hash-0da93712208ccce43badde9998369ec8b785af649c804e812feb2bb580f2908c",
      "name": "Blazing Scorcher",
      "fullName": "Blazing Scorcher",
      "localizedName": "灼焰飞龙",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Dragon",
        "Noxus"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-001/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/15ed971e4029a92b362a81ccadf309fb81e40b81-744x1039.png?accountingTag=RB",
      "energy": 5,
      "power": null,
      "might": 5,
      "ability": "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
    },
    {
      "id": "ogn-002-298",
      "canonicalCardId": "card.hash-da18079d11afce4cad1d799fd51de5b0219e0635613cd5a5b4a5f38e1a42aafc",
      "name": "Brazen Buccaneer",
      "fullName": "Brazen Buccaneer",
      "localizedName": "粗鲁的海盗",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Pirate",
        "Bilgewater"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-002/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d481971f7560e7235e7d6934767da18daa019eff-744x1039.png?accountingTag=RB",
      "energy": 6,
      "power": null,
      "might": 5,
      "ability": "As you play me, you may discard 1 as an additional cost. If you do, reduce my cost by :rb_energy_2:."
    },
    {
      "id": "ogn-003-298",
      "canonicalCardId": "card.hash-ed8cf6c764ed889b192049c35919693d1664dee6da3044cdb42dae8a561a5a59",
      "name": "Chemtech Enforcer",
      "fullName": "Chemtech Enforcer",
      "localizedName": "炼金太保",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Zaun"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-003/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/19dcf211457d9c9c6e9ea0cd32af76c2c92a3160-744x1039.png?accountingTag=RB",
      "energy": 2,
      "power": null,
      "might": 2,
      "ability": "[Assault 2] (+2 :rb_might: while I'm an attacker.)\nWhen you play me, discard 1."
    },
    {
      "id": "ogn-004-298",
      "canonicalCardId": "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354",
      "name": "Cleave",
      "fullName": "Cleave",
      "localizedName": "顺劈",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-004/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/95d476a1e88ff547fb846149619177bc7e3cea9f-744x1039.png?accountingTag=RB",
      "energy": 1,
      "power": null,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nGive a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)"
    },
    {
      "id": "ogn-005-298",
      "canonicalCardId": "card.hash-59023abea680c1ec0358c2f407d08193931447ee6c2b18ad3f0a0588b4f6501f",
      "name": "Disintegrate",
      "fullName": "Disintegrate",
      "localizedName": "碎裂之火",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-005/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a27374ac3a81f3dfefb43c3c3237c23b4883cb5a-744x1039.png?accountingTag=RB",
      "energy": 4,
      "power": null,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, draw 1."
    },
    {
      "id": "ogn-006-298",
      "canonicalCardId": "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9",
      "name": "Flame Chompers",
      "fullName": "Flame Chompers",
      "localizedName": "嚼火者手雷",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Zaun"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-006/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1f6f5ebd18e5daac30d62626fddd785c4b457c2b-744x1039.png?accountingTag=RB",
      "energy": 3,
      "power": null,
      "might": 3,
      "ability": "When you discard me, you may pay :rb_rune_fury: to play me."
    },
    {
      "id": "ogn-008-298",
      "canonicalCardId": "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826",
      "name": "Get Excited!",
      "fullName": "Get Excited!",
      "localizedName": "Get Excited!",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-008/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/2906c932c482af17fbb2979a8c42a6992f95d6a6-744x1039.png?accountingTag=RB",
      "energy": 2,
      "power": 1,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nDiscard 1. Deal its Energy cost as damage to a unit at a battlefield. (Ignore its Power cost.)"
    },
    {
      "id": "ogn-009-298",
      "canonicalCardId": "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d",
      "name": "Hextech Ray",
      "fullName": "Hextech Ray",
      "localizedName": "海克斯射线",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-009/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1e7d12693822c38377ddc8f15db23e2f9b6d560a-744x1039.png?accountingTag=RB",
      "energy": 1,
      "power": 1,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield."
    },
    {
      "id": "ogn-010-298",
      "canonicalCardId": "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497",
      "name": "Legion Rearguard",
      "fullName": "Legion Rearguard",
      "localizedName": "军团后卫",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Trifarian",
        "Noxus"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-010/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aedece01c7792c689050460db1670e6b9b15b61f-744x1039.png?accountingTag=RB",
      "energy": 2,
      "power": null,
      "might": 2,
      "ability": "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)"
    },
    {
      "id": "ogn-011-298",
      "canonicalCardId": "card.hash-d92b1df4324a20717aaeab68c916883889ea337f917bdf10104e9df82f9a3c19",
      "name": "Magma Wurm",
      "fullName": "Magma Wurm",
      "localizedName": "熔浆巨龙",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Freljord"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-011/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f6565b15f65f538804e6a56623c8aa2eedeffc22-744x1039.png?accountingTag=RB",
      "energy": 8,
      "power": 1,
      "might": 8,
      "ability": "Other friendly units enter ready."
    },
    {
      "id": "ogn-012-298",
      "canonicalCardId": "card.hash-d8fc7a6f007a594060f40601cd5a28becae060a1537ac98db24d17e8039fc452",
      "name": "Noxus Hopeful",
      "fullName": "Noxus Hopeful",
      "localizedName": "诺克萨斯新兵",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Trifarian",
        "Noxus"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-012/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c3bb6f4cb58feeb50e396d12ec9865c5434025af-744x1039.png?accountingTag=RB",
      "energy": 4,
      "power": null,
      "might": 4,
      "ability": "[Legion] — I cost :rb_energy_2: less. (Get the effect if you've played another card this turn.)"
    },
    {
      "id": "ogn-013-298",
      "canonicalCardId": "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452",
      "name": "Pouty Poro",
      "fullName": "Pouty Poro",
      "localizedName": "呸呸魄罗",
      "cardType": "Unit",
      "domains": [
        "Fury"
      ],
      "tags": [
        "Poro"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-013/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d541bf3bcb5aa3ad0d48d87f5753569b72ac426f-744x1039.png?accountingTag=RB",
      "energy": 2,
      "power": null,
      "might": 2,
      "ability": "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
    },
    {
      "id": "ogn-014-298",
      "canonicalCardId": "card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f",
      "name": "Sky Splitter",
      "fullName": "Sky Splitter",
      "localizedName": "霹天雳地",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-014/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/01faae468720dd5bf5e3fe12ba56c01af70263be-744x1039.png?accountingTag=RB",
      "energy": 8,
      "power": 1,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nThis spell's Energy cost is reduced by the highest Might among units you control.\nDeal 5 to a unit at a battlefield."
    },
    {
      "id": "ogn-022-298",
      "canonicalCardId": "card.hash-6a20eaa5d0de7ffae215ad7179d8429ac1a7b0cf0e32667d6cdaf0a546cc7edf",
      "name": "Thermo Beam",
      "fullName": "Thermo Beam",
      "localizedName": "热电光束",
      "cardType": "Spell",
      "domains": [
        "Fury"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-022/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/88661e852b864491e6d7f5f087caf4263f61c361-744x1039.png?accountingTag=RB",
      "energy": 5,
      "power": 2,
      "might": null,
      "ability": "[Action] (Play on your turn or in showdowns.)\nKill all gear."
    },
    {
      "id": "ogn-214-298",
      "canonicalCardId": "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67",
      "name": "Order Rune",
      "fullName": "Order Rune",
      "localizedName": "序理符文",
      "cardType": "Rune",
      "domains": [
        "Order"
      ],
      "tags": [
        "Basic"
      ],
      "setCode": "ogn",
      "cardNumber": "OGN-214/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/35ec6fdd2124324bb7052cba31c8c44f2e98f3ae-744x1039.png?accountingTag=RB",
      "energy": null,
      "power": null,
      "might": null,
      "ability": ""
    },
    {
      "id": "unl-176-219",
      "canonicalCardId": "card.hash-940239e930273675dbfef51d216846a7ba2391c6eb507a28893f250c32eee6cd",
      "name": "Vi",
      "subtitle": "Peacekeeper",
      "fullName": "Vi, Peacekeeper",
      "localizedName": "蔚",
      "localizedSubtitle": "和平卫士",
      "cardType": "Unit",
      "domains": [
        "Order"
      ],
      "tags": [
        "Vi",
        "Piltover",
        "Champion"
      ],
      "setCode": "unl",
      "cardNumber": "UNL-176/219",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/51610bbdecd77b15f58b9a968611e536ebdf445e-744x1039.png?accountingTag=RB",
      "energy": 5,
      "power": 1,
      "might": 5,
      "ability": "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\nWhen I attack, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)"
    },
    {
      "id": "unl-187-219",
      "canonicalCardId": "card.hash-8e09f40d2b739aa2e5e38a58cb0c9b9a2682ab534807bcc62c90206e763d6856",
      "name": "Piltover Enforcer",
      "fullName": "Piltover Enforcer",
      "localizedName": "皮城执法官",
      "cardType": "Legend",
      "domains": [
        "Fury",
        "Order"
      ],
      "tags": [
        "Vi"
      ],
      "setCode": "unl",
      "cardNumber": "UNL-187/219",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b52fca3d644599008c4b1a67ffd359a9f9c4d8d7-744x1039.png?accountingTag=RB",
      "energy": null,
      "power": null,
      "might": null,
      "ability": "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit."
    },
    {
      "id": "ogn-275-298",
      "canonicalCardId": "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099",
      "name": "Altar to Unity",
      "fullName": "Altar to Unity",
      "localizedName": "团结圣坛",
      "cardType": "Battlefield",
      "domains": [
        "Colorless"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-275/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/2392529560dc9af72596c6fc65b4c0356bbc44d1-1038x744.png?accountingTag=RB",
      "energy": null,
      "power": null,
      "might": null,
      "ability": "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
    },
    {
      "id": "ogn-277-298",
      "canonicalCardId": "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a",
      "name": "Back-Alley Bar",
      "fullName": "Back-Alley Bar",
      "localizedName": "后巷酒吧",
      "cardType": "Battlefield",
      "domains": [
        "Colorless"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-277/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3e9f659a32e390b45bc87a01bdd6af4a8a3565f7-1038x744.png?accountingTag=RB",
      "energy": null,
      "power": null,
      "might": null,
      "ability": "When a unit moves from here, give it +1 :rb_might: this turn."
    },
    {
      "id": "ogn-278-298",
      "canonicalCardId": "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c",
      "name": "Bandle Tree",
      "fullName": "Bandle Tree",
      "localizedName": "班德尔树",
      "cardType": "Battlefield",
      "domains": [
        "Colorless"
      ],
      "tags": [],
      "setCode": "ogn",
      "cardNumber": "OGN-278/298",
      "variant": "standard",
      "imageUrl": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/538f93a34006c4afaddb890cbc75b4db222f1783-1038x744.png?accountingTag=RB",
      "energy": null,
      "power": null,
      "might": null,
      "ability": "You may hide an additional card here."
    }
  ]
};

/**
 * Two representative unit decks, structurally mirroring the real
 * `gui-valid-room-deck-fixtures` A/B submissions (39 main = 13 distinct
 * canonicals x3, 1 Champion, 1 Legend, 12 Runes, 3 Colorless Battlefields,
 * empty sideboard). A and B differ only in their final main-deck canonical.
 */
export const setupAdapterFixtureDecks: {
  readonly a: SetupAdapterFixtureDeck;
  readonly b: SetupAdapterFixtureDeck;
} = {
  a: {
    id: "setup-adapter.fixture.a",
    name: "Setup Adapter Fixture A",
    submission:     {
      "mainDeck": [
        {
          "cardId": "ogn-001-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-002-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-003-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-004-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-005-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-006-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-008-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-009-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-010-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-011-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-012-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-013-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-014-298",
          "quantity": 3
        }
      ],
      "runes": [
        {
          "cardId": "ogn-214-298",
          "quantity": 12
        }
      ],
      "legend": [
        {
          "cardId": "unl-187-219",
          "quantity": 1
        }
      ],
      "champion": [
        {
          "cardId": "unl-176-219",
          "quantity": 1
        }
      ],
      "battlefields": [
        {
          "cardId": "ogn-275-298",
          "quantity": 1
        },
        {
          "cardId": "ogn-277-298",
          "quantity": 1
        },
        {
          "cardId": "ogn-278-298",
          "quantity": 1
        }
      ],
      "sideboard": []
    }
  },
  b: {
    id: "setup-adapter.fixture.b",
    name: "Setup Adapter Fixture B",
    submission:     {
      "mainDeck": [
        {
          "cardId": "ogn-001-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-002-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-003-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-004-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-005-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-006-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-008-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-009-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-010-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-011-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-012-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-013-298",
          "quantity": 3
        },
        {
          "cardId": "ogn-022-298",
          "quantity": 3
        }
      ],
      "runes": [
        {
          "cardId": "ogn-214-298",
          "quantity": 12
        }
      ],
      "legend": [
        {
          "cardId": "unl-187-219",
          "quantity": 1
        }
      ],
      "champion": [
        {
          "cardId": "unl-176-219",
          "quantity": 1
        }
      ],
      "battlefields": [
        {
          "cardId": "ogn-275-298",
          "quantity": 1
        },
        {
          "cardId": "ogn-277-298",
          "quantity": 1
        },
        {
          "cardId": "ogn-278-298",
          "quantity": 1
        }
      ],
      "sideboard": []
    }
  }
};
