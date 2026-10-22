import type { RoomDeckSubmission } from "@riftbound/protocol";
import type { CatalogCard } from "../../net/CardCatalogClient";

export const V2_M1_PRECON_IDS = ["rumble-sfd", "fiora-sfd"] as const;
export type V2M1PreconId = (typeof V2_M1_PRECON_IDS)[number];

interface PreconEntry {
  readonly zone: "legend" | "champion" | "mainDeck" | "runes" | "battlefields";
  readonly canonicalCardId: string;
  readonly quantity: number;
}

type PreconTuple = readonly [PreconEntry["zone"], string, number];

export interface PreconCatalogEntry {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly variant?: string;
  readonly available?: boolean;
}

/**
 * Exact M1 deck list. These ids are canonical ids; only a server catalog
 * printing mapped from the same canonical id is submitted on the wire.
 */
const PRECON_ROWS: Readonly<Record<V2M1PreconId, readonly PreconTuple[]>> = {
  "rumble-sfd": [
    ["legend", "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7", 1],
    ["champion", "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870", 1],
    ["mainDeck", "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3", 2],
    ["mainDeck", "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870", 1],
    ["mainDeck", "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9", 3],
    ["mainDeck", "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91", 3],
    ["mainDeck", "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40", 3],
    ["mainDeck", "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389", 3],
    ["mainDeck", "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82", 3],
    ["mainDeck", "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab", 2],
    ["mainDeck", "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c", 1],
    ["mainDeck", "card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007", 2],
    ["mainDeck", "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b", 1],
    ["mainDeck", "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c", 2],
    ["mainDeck", "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9", 2],
    ["mainDeck", "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b", 3],
    ["mainDeck", "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf", 2],
    ["mainDeck", "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10", 3],
    ["mainDeck", "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e", 1],
    ["mainDeck", "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569", 1],
    ["mainDeck", "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010", 1],
    ["battlefields", "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4", 1],
    ["battlefields", "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82", 1],
    ["battlefields", "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564", 1],
    ["runes", "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b", 6],
    ["runes", "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902", 6]
  ],
  "fiora-sfd": [
    ["legend", "card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4", 1],
    ["champion", "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f", 1],
    ["mainDeck", "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f", 1],
    ["mainDeck", "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732", 2],
    ["mainDeck", "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6", 2],
    ["mainDeck", "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef", 2],
    ["mainDeck", "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7", 2],
    ["mainDeck", "card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed", 2],
    ["mainDeck", "card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f", 2],
    ["mainDeck", "card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103", 2],
    ["mainDeck", "card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de", 2],
    ["mainDeck", "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f", 1],
    ["mainDeck", "card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56", 1],
    ["mainDeck", "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3", 2],
    ["mainDeck", "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177", 3],
    ["mainDeck", "card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa", 2],
    ["mainDeck", "card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d", 1],
    ["mainDeck", "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f", 2],
    ["mainDeck", "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe", 3],
    ["mainDeck", "card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322", 3],
    ["mainDeck", "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0", 1],
    ["mainDeck", "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1", 3],
    ["battlefields", "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad", 1],
    ["battlefields", "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5", 1],
    ["battlefields", "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b", 1],
    ["runes", "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67", 6],
    ["runes", "card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17", 6]
  ]
};

const materialize = (rows: readonly PreconTuple[]): readonly PreconEntry[] =>
  rows.map(([zone, canonicalCardId, quantity]) => ({ zone, canonicalCardId, quantity }));

export const V2_M1_PRECON_LISTS: Readonly<Record<V2M1PreconId, readonly PreconEntry[]>> = {
  "rumble-sfd": materialize(PRECON_ROWS["rumble-sfd"]),
  "fiora-sfd": materialize(PRECON_ROWS["fiora-sfd"])
};

export function printingForCanonical(
  cards: readonly PreconCatalogEntry[],
  canonicalCardId: string
): string | null {
  const matches = cards.filter(card => card.canonicalCardId === canonicalCardId && card.available !== false);
  const preferred = matches.find(card => card.variant === "standard") ?? matches[0] ?? null;
  return preferred?.id ?? null;
}

export function buildV2PreconSubmission(
  id: V2M1PreconId,
  cards: readonly CatalogCard[]
): { readonly deck: RoomDeckSubmission; readonly missing: readonly string[] } {
  const entries: Partial<Record<keyof RoomDeckSubmission, { cardId: string; quantity: number }[]>> = {};
  const missing: string[] = [];
  for (const entry of V2_M1_PRECON_LISTS[id]) {
    const printing = printingForCanonical(cards, entry.canonicalCardId);
    if (printing === null) {
      if (!missing.includes(entry.canonicalCardId)) missing.push(entry.canonicalCardId);
      continue;
    }
    const zone = entries[entry.zone] ?? [];
    zone.push({ cardId: printing, quantity: entry.quantity });
    entries[entry.zone] = zone;
  }
  return { deck: entries, missing };
}

export function validateV2PreconShape(id: V2M1PreconId): boolean {
  const entries = V2_M1_PRECON_LISTS[id];
  const total = (zone: PreconEntry["zone"]) => entries
    .filter(entry => entry.zone === zone)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  return total("legend") === 1 && total("champion") === 1 &&
    total("mainDeck") === 39 && total("battlefields") === 3 && total("runes") === 12;
}
