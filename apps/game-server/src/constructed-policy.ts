import type {
  DeckCardDefinition,
  DeckValidationIssue,
  DeckValidationRules,
  DeckValidationResult,
  DeckZone
} from "./deck-validation.js";
import { validateDeck, type DeckSubmission } from "./deck-validation.js";

export type ConstructedFormat = "standard";

export type ConstructedCardPolicyStatus =
  | "legal"
  | "banned"
  | "unreleased"
  | "notStandard";

export type ConstructedPrintingPolicyStatus =
  | "available"
  | "banned"
  | "previewNotReleased"
  | "notStandard";

export interface ConstructedCardPolicy {
  readonly status: ConstructedCardPolicyStatus;
  readonly maxCopies: number;
  readonly policyType: "limited";
}

export interface ConstructedPolicyCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly fullName: string;
  readonly cardType: string;
  readonly setCode: string;
  /**
   * Server-derived identity metadata copied from the same catalog cards.
   * Optional so existing callers keep compiling; supplying it is what enables
   * Domain Identity, Champion Legend tag and Signature checking.
   */
  readonly domains?: readonly string[];
  readonly tags?: readonly string[];
  /**
   * Official English character name of the card (e.g. `Jinx` for
   * `Jinx, Rebel`). Optional so existing literals keep compiling; when present
   * it lets the server cross-check a champion unit's own name against the
   * champion family its tags resolve to.
   */
  readonly name?: string;
}

/**
 * Server-private per-printing identity metadata.
 *
 * It is derived from the authoritative card catalog and is intentionally kept
 * out of `ConstructedPublicPolicy` and every transport payload: only the
 * server-owned validator reads it.
 */
export interface ConstructedCardIdentityMetadata {
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly name?: string;
}

export interface ConstructedIdentityMetadata {
  readonly byCardId: ReadonlyMap<string, ConstructedCardIdentityMetadata>;
  /**
   * Server-private set of champion tag names collected from trusted catalog
   * champion units whose `name` literally appears among their own tags
   * (CR 133.8.b). It is only used to pick the champion family of a Legend or
   * Signature card and is never spread into the public policy or any transport
   * payload. It never rewrites the raw per-printing `tags`.
   */
  readonly knownChampionTags: ReadonlySet<string>;
}

export interface ConstructedPrintingPolicy {
  readonly status: ConstructedPrintingPolicyStatus;
  readonly available: boolean;
  readonly setCode: string;
}

export interface ConstructedSourceProvenance {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly lastUpdated?: string;
}

export interface ConstructedBanTarget {
  readonly officialName: string;
  readonly resolvedFullName: string;
  readonly canonicalCardId: string;
  readonly sourceId: string;
  readonly aliases: readonly string[];
}

export interface ConstructedMissingBanTarget {
  readonly officialName: string;
  readonly sourceId: string;
  readonly reason: string;
}

export interface ConstructedZoneRule {
  readonly zone: DeckZone;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly defaultMaxCopiesPerCanonical?: number;
}

export interface ConstructedPolicyLimitation {
  readonly id: string;
  readonly description: string;
}

export interface ConstructedPublicPolicy {
  readonly format: ConstructedFormat;
  readonly checkedAt: string;
  readonly banResolutionComplete: boolean;
  readonly tournamentComplete: false;
  readonly policyScope: string;
  readonly limitations: readonly ConstructedPolicyLimitation[];
  readonly sources: readonly ConstructedSourceProvenance[];
  readonly zoneRules: readonly ConstructedZoneRule[];
  readonly cardPolicies: Readonly<Record<string, ConstructedCardPolicy>>;
  readonly printingPolicies: Readonly<Record<string, ConstructedPrintingPolicy>>;
  readonly bannedTargets: readonly ConstructedBanTarget[];
  readonly missingBannedNames: readonly string[];
  readonly missingBannedTargets: readonly ConstructedMissingBanTarget[];
  readonly standard: {
    readonly legalSetCodes: readonly string[];
    readonly radiance: {
      readonly status: "preview-not-released" | "active";
      readonly effectiveDate: "2026-10-16";
      readonly releaseDate: "2026-10-23";
    };
  };
}

export interface ConstructedRulesOptions {
  readonly asOf?: string | Date;
}

export interface ConstructedRules {
  readonly rules: DeckValidationRules;
  readonly policy: ConstructedPublicPolicy;
  /**
   * Private server-derived identity lookup used by `validateConstructedDeck`.
   * Never spread into the public policy or any client-facing payload.
   */
  readonly identityMetadata: ConstructedIdentityMetadata;
}

export interface ConstructedPrintingIssue {
  readonly cardId: string;
  readonly canonicalCardId?: string;
  readonly zone: DeckZone;
  readonly status: ConstructedPrintingPolicyStatus;
  readonly message: string;
}

export interface ConstructedValidationResult extends DeckValidationResult {
  readonly printingIssues: readonly ConstructedPrintingIssue[];
}

interface OfficialBanDefinition {
  readonly officialName: string;
  readonly aliases?: readonly string[];
}

const STANDARD_LEGAL_SET_CODES = ["ogs", "ogn", "sfd", "unl", "ven"] as const;
const RADIANCE_SET_CODE = "rad";
const RADIANCE_EFFECTIVE_DATE = "2026-10-16";
const RADIANCE_EFFECTIVE_AT = "2026-10-16T00:00:00.000Z";
const RADIANCE_RELEASE_DATE = "2026-10-23";
const RUNE_MAX_COPIES = 12;
const BATTLEFIELD_MAX_COPIES = 1;
const DEFAULT_MAX_COPIES = 3;
const SIGNATURE_MAX_TOTAL = 3;
const CHAMPION_TAG_MARKER = "Champion";
const SIGNATURE_TAG_MARKER = "Signature";
const COLORLESS_DOMAIN = "Colorless";
const LEGEND_CARD_TYPE = "legend";
const UNIT_CARD_TYPE = "unit";
/**
 * CR 103.2.c / 103.3.a.1 / 103.4.b apply Domain Identity to the Main Deck
 * (including the Champion slot), the Rune Deck and the Battlefields. CR 103
 * itself does not state a sideboard rule, but the tournament Constructed rules
 * do: TR 2026-07-16 601.1.c.2 requires a sideboard to consist only of valid
 * Main Deck cards, so every sideboard card must also satisfy the Main Deck
 * Domain Identity. Sideboard is therefore included in the domain containment
 * check below.
 */
const DOMAIN_IDENTITY_ZONES: readonly DeckZone[] = [
  "mainDeck",
  "champion",
  "runes",
  "battlefields",
  "sideboard"
];
/**
 * CR 103.2.d constrains the Signature total of the deck as a whole; the check
 * inspects every submitted zone, including sideboard.
 */
const SIGNATURE_COUNT_ZONES: readonly DeckZone[] = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
];

const POLICY_LIMITATIONS: readonly ConstructedPolicyLimitation[] = [
  {
    id: "domain-identity",
    description:
      "Domain Identity 已按 CR 103.1.b.2-4 / 103.2.c / 103.3.a.1 / 103.4.b 实现：Main Deck、Chosen Champion、Rune Deck 与 Battlefields 中声明了域的卡牌，必须使其全部域包含于 Champion Legend 的域；未声明域的卡牌不套用该限制。Sideboard 是否适用 CR 103 未明文，未纳入域校验。"
  },
  {
    id: "champion-legend-signature",
    description:
      "Chosen Champion 与 Signature 已按 CR 103.2.a.2 / 103.2.d 实现（须为带 Champion 标记的 Unit、tag 与 Champion Legend 匹配、Signature 合计最多 3 张、Signature 不得进 Champion 区）；Signature 合计按提交 deck 的所有区（含 sideboard）跨卡名累加，而 CR 103.2.d 未明示 sideboard 归属。champion family 由 catalog 中 Unit+Champion 且自身 name 出现在自身 tags 的卡收集出的私有 champion tag 名集解析（CR 133.8.b），地区/生物 tag（Yordle、Dog、Shurima 等）不参与匹配；仍未解决：当该名集与卡面 tags 自相矛盾（如 catalog 内 Karma, Channeler 的 Vi/Karma 冲突）或交集非唯一时，判定为 identity_metadata_unavailable 而非猜一个 family；Signature 卡跨印刷的合计口径以 catalog 提供的 printing 元数据为准。"
  },
  {
    id: "identity-metadata",
    description:
      "当 catalog 未提供或无法解析 Legend 的域/champion tag、或牌张缺少身份元数据时，deck 会被判定为不合法并给出 identity_metadata_unavailable，而不是按空 identity 放行。"
  },
  {
    id: "colorless-domain",
    description:
      "Battlefields 的域为 [\"Colorless\"]，CR 103 未定义 Colorless 与 Domain Identity 的关系，因此该卡不套用域包含判定；此为需裁定的未核验项。"
  },
  {
    id: "effect-added-cards",
    description:
      "CR 103.1.b.5 允许 game effect 无视域往 deck 加卡；该例外无法由静态 catalog 判定，未实现，仍需 judge/官方裁定。"
  },
  {
    id: "regional-product-availability",
    description:
      "Regional product availability and release dates are represented as policy metadata, not independently verified."
  }
];

const RULES_HUB_SOURCE: ConstructedSourceProvenance = {
  id: "rules-hub-constructed-legality",
  name: "Rules Hub: Constructed Format Legality",
  url: "https://playriftbound.com/en-us/rules-hub/",
  lastUpdated: "2026-09-18"
};

const CARD_SNAPSHOT_SOURCE: ConstructedSourceProvenance = {
  id: "card-snapshot-official-english-full-name",
  name: "Official card snapshot, official English fullName",
  url: "https://playriftbound.com/en-us/card-gallery/"
};

const OFFICIAL_CONSTRUCTED_BANS: readonly OfficialBanDefinition[] = [
  { officialName: "Called Shot" },
  { officialName: "Ekko, Recurrent" },
  { officialName: "Draven, Vanquisher" },
  { officialName: "Fight or Flight" },
  { officialName: "Scrapheap" },
  { officialName: "Stealthy Pursuer" },
  { officialName: "Stacked Deck" },
  { officialName: "The Arena’s Greatest", aliases: ["The Arena's Greatest"] },
  { officialName: "Aspirant’s Climb", aliases: ["Aspirant's Climb"] },
  {
    officialName: "Dreaming Tree",
    aliases: ["The Dreaming Tree"]
  },
  { officialName: "Obelisk of Power" },
  { officialName: "Reaver’s Row", aliases: ["Reaver's Row"] }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isPolicyCard(value: unknown): value is ConstructedPolicyCard {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.canonicalCardId) &&
    isNonEmptyString(value.fullName) &&
    isNonEmptyString(value.cardType) &&
    isNonEmptyString(value.setCode) &&
    (value.domains === undefined || isStringList(value.domains)) &&
    (value.tags === undefined || isStringList(value.tags)) &&
    (value.name === undefined || isNonEmptyString(value.name));
}

function normalizedCardType(cardType: string): string {
  return cardType.trim().toLowerCase();
}

function isLegendCardType(cardType: string): boolean {
  return normalizedCardType(cardType) === LEGEND_CARD_TYPE;
}

function isUnitCardType(cardType: string): boolean {
  return normalizedCardType(cardType) === UNIT_CARD_TYPE;
}

function identityTags(tags: readonly string[]): readonly string[] {
  return tags.filter(
    tag => tag !== CHAMPION_TAG_MARKER && tag !== SIGNATURE_TAG_MARKER
  );
}

function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.includes(tag);
}

/**
 * Builds the server-private identity lookup. Cards that do not carry both
 * `domains` and `tags` are left out on purpose: the validator must report the
 * missing metadata instead of inventing an identity for them.
 *
 * The trusted catalog is also scanned for champion tag names (CR 133.8.b): a
 * card is a named source when it is a Unit carrying the `Champion` marker and
 * its own `name` literally appears among its tags. The collected set is only
 * used to look up a Legend/Signature champion family; it never overwrites the
 * per-printing `tags`.
 */
function buildIdentityMetadata(
  cards: readonly ConstructedPolicyCard[]
): ConstructedIdentityMetadata {
  const byCardId = new Map<string, ConstructedCardIdentityMetadata>();
  const knownChampionTags = new Set<string>();
  for (const card of cards) {
    if (card.tags !== undefined &&
        card.name !== undefined &&
        isUnitCardType(card.cardType) &&
        hasTag(card.tags, CHAMPION_TAG_MARKER) &&
        // The reserved `Champion`/`Signature` supertype markers are not tag
        // names, so a `name` that only matches a marker is never a family.
        hasTag(identityTags(card.tags), card.name)) {
      knownChampionTags.add(card.name);
    }
    if (card.domains === undefined || card.tags === undefined) continue;
    byCardId.set(card.id, {
      cardId: card.id,
      canonicalCardId: card.canonicalCardId,
      cardType: card.cardType,
      domains: [...card.domains],
      tags: [...card.tags],
      ...(card.name === undefined ? {} : { name: card.name })
    });
  }
  return { byCardId, knownChampionTags };
}

interface ChampionFamilyResolution {
  /**
   * The single champion family, or `undefined` when the card cannot be named
   * unambiguously.
   */
  readonly family?: string;
  /** Candidate champion tags that survived the lookup (may be empty or many). */
  readonly candidates: readonly string[];
  /**
   * True when the catalog carries no named champion source at all, so the
   * original "exactly one non-marker tag" rule is kept for small legacy
   * fixtures instead of wrongly declaring an unknown family.
   */
  readonly usedLegacyFallback: boolean;
}

/**
 * Resolves the champion family of a Legend/Signature card (CR 103.2.a.2 /
 * 103.2.d.2 / 133.8.b). The family is the single non-marker tag that is also a
 * known champion tag name collected from the trusted catalog. Region or
 * creature tags such as `Yordle`, `Dog` or `Shurima` are never treated as a
 * family, and 0 or 2+ candidates stay unresolved instead of being guessed.
 */
function resolveChampionFamily(
  tags: readonly string[],
  knownChampionTags: ReadonlySet<string>
): ChampionFamilyResolution {
  const nonMarker = identityTags(tags);
  if (knownChampionTags.size === 0) {
    return {
      family: nonMarker.length === 1 ? nonMarker[0] : undefined,
      candidates: nonMarker,
      usedLegacyFallback: true
    };
  }
  const candidates = nonMarker.filter(tag => knownChampionTags.has(tag));
  return {
    family: candidates.length === 1 ? candidates[0] : undefined,
    candidates,
    usedLegacyFallback: false
  };
}

export function cardTypeZoneMaxCopies(cardType: string): number {
  const normalized = cardType.trim().toLowerCase();
  if (normalized === "battlefield") return BATTLEFIELD_MAX_COPIES;
  if (normalized === "rune") return RUNE_MAX_COPIES;
  return DEFAULT_MAX_COPIES;
}

function isStandardLegalSet(setCode: string): boolean {
  return (STANDARD_LEGAL_SET_CODES as readonly string[]).includes(
    setCode.trim().toLowerCase()
  );
}

function isRadianceSet(setCode: string): boolean {
  return setCode.trim().toLowerCase() === RADIANCE_SET_CODE;
}

function resolveAsOf(value: string | Date | undefined): {
  readonly checkedAt: string;
  readonly radianceActive: boolean;
} {
  const instant = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value ?? Date.now());
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Constructed policy asOf must be a valid date.");
  }

  return {
    checkedAt: instant.toISOString().slice(0, 10),
    radianceActive: instant.getTime() >= Date.parse(RADIANCE_EFFECTIVE_AT)
  };
}

function buildCanonicalIndex(
  cards: readonly ConstructedPolicyCard[]
): Map<string, string> {
  const fullNameToCanonical = new Map<string, string>();
  const canonicalToFullName = new Map<string, string>();
  const ids = new Set<string>();
  const canonicalIds = new Set<string>();

  for (const card of cards) {
    if (!isPolicyCard(card)) {
      throw new Error("Constructed policy cards must be non-empty card records.");
    }
    if (ids.has(card.id)) {
      throw new Error(`Constructed policy contains duplicate card id ${card.id}.`);
    }
    ids.add(card.id);
    canonicalIds.add(card.canonicalCardId);

    const existingCanonical = fullNameToCanonical.get(card.fullName);
    if (existingCanonical !== undefined &&
        existingCanonical !== card.canonicalCardId) {
      throw new Error(
        `Official English fullName ${card.fullName} maps to multiple canonical cards.`
      );
    }
    fullNameToCanonical.set(card.fullName, card.canonicalCardId);

    const existingFullName = canonicalToFullName.get(card.canonicalCardId);
    if (existingFullName !== undefined && existingFullName !== card.fullName) {
      throw new Error(
        `Canonical card ${card.canonicalCardId} maps to multiple official English fullNames.`
      );
    }
    canonicalToFullName.set(card.canonicalCardId, card.fullName);
  }

  if (canonicalIds.size === 0) {
    throw new Error("Constructed policy requires at least one canonical card.");
  }
  return fullNameToCanonical;
}

function resolveOfficialName(
  fullNameToCanonical: ReadonlyMap<string, string>,
  name: string
): string | undefined {
  return fullNameToCanonical.get(name);
}

function resolveBans(
  fullNameToCanonical: ReadonlyMap<string, string>
): {
  readonly bannedTargets: readonly ConstructedBanTarget[];
  readonly missingBannedTargets: readonly ConstructedMissingBanTarget[];
} {
  const bannedTargets: ConstructedBanTarget[] = [];
  const missingBannedTargets: ConstructedMissingBanTarget[] = [];

  for (const definition of OFFICIAL_CONSTRUCTED_BANS) {
    let canonicalCardId = resolveOfficialName(
      fullNameToCanonical,
      definition.officialName
    );
    let resolvedFullName = canonicalCardId === undefined
      ? undefined
      : definition.officialName;

    if (canonicalCardId === undefined) {
      for (const alias of definition.aliases ?? []) {
        const aliasCanonicalCardId = resolveOfficialName(
          fullNameToCanonical,
          alias
        );
        if (aliasCanonicalCardId !== undefined) {
          if (canonicalCardId !== undefined &&
              canonicalCardId !== aliasCanonicalCardId) {
            throw new Error(
              `Official ban aliases for ${definition.officialName} resolve to different canonical cards.`
            );
          }
          canonicalCardId = aliasCanonicalCardId;
          resolvedFullName = alias;
        }
      }
    }

    if (canonicalCardId === undefined || resolvedFullName === undefined) {
      missingBannedTargets.push({
        officialName: definition.officialName,
        sourceId: RULES_HUB_SOURCE.id,
        reason:
          "No card in the snapshot has this exact official English fullName or an explicitly recorded source alias."
      });
      continue;
    }

    bannedTargets.push({
      officialName: definition.officialName,
      resolvedFullName,
      canonicalCardId,
      sourceId: RULES_HUB_SOURCE.id,
      aliases: definition.aliases ?? []
    });
  }

  return { bannedTargets, missingBannedTargets };
}

export function createConstructedRules(
  cards: readonly ConstructedPolicyCard[],
  format: ConstructedFormat = "standard",
  options: ConstructedRulesOptions = {}
): ConstructedRules {
  if (format !== "standard") {
    throw new Error(`Unsupported constructed format ${format}.`);
  }

  const { checkedAt, radianceActive } = resolveAsOf(options.asOf);
  const fullNameToCanonical = buildCanonicalIndex(cards);
  const identityMetadata = buildIdentityMetadata(cards);
  const { bannedTargets, missingBannedTargets } = resolveBans(
    fullNameToCanonical
  );
  const bannedCanonicalIds = new Set(
    bannedTargets.map(target => target.canonicalCardId)
  );

  const cardPolicies: Record<string, ConstructedCardPolicy> = {};
  const printingPolicies: Record<string, ConstructedPrintingPolicy> = {};
  const bannedServerPolicies: Record<string, { readonly type: "banned" }> = {};

  const canonicalCards = new Map<string, ConstructedPolicyCard>();
  for (const card of cards) {
    printingPolicies[card.id] = {
      status: bannedCanonicalIds.has(card.canonicalCardId)
        ? "banned"
        : isRadianceSet(card.setCode)
          ? radianceActive
            ? "available"
            : "previewNotReleased"
          : isStandardLegalSet(card.setCode)
            ? "available"
            : "notStandard",
      available: bannedCanonicalIds.has(card.canonicalCardId) === false &&
        (isStandardLegalSet(card.setCode) ||
          (radianceActive && isRadianceSet(card.setCode))),
      setCode: card.setCode
    };
    if (!canonicalCards.has(card.canonicalCardId)) {
      canonicalCards.set(card.canonicalCardId, card);
    }
  }

  for (const [canonicalCardId, card] of canonicalCards) {
    if (bannedCanonicalIds.has(canonicalCardId)) {
      cardPolicies[card.canonicalCardId] = {
        status: "banned",
        maxCopies: 0,
        policyType: "limited"
      };
      bannedServerPolicies[canonicalCardId] = { type: "banned" };
      continue;
    }

    const hasAvailablePrinting = cards.some(candidate =>
      candidate.canonicalCardId === canonicalCardId &&
      (isStandardLegalSet(candidate.setCode) ||
        (radianceActive && isRadianceSet(candidate.setCode)))
    );
    if (!hasAvailablePrinting && isRadianceSet(card.setCode)) {
      cardPolicies[card.canonicalCardId] = {
        status: "unreleased",
        maxCopies: 0,
        policyType: "limited"
      };
      continue;
    }

    if (!hasAvailablePrinting) {
      cardPolicies[card.canonicalCardId] = {
        status: "notStandard",
        maxCopies: 0,
        policyType: "limited"
      };
      continue;
    }

    cardPolicies[canonicalCardId] = {
      status: "legal",
      maxCopies: cardTypeZoneMaxCopies(card.cardType),
      policyType: "limited"
    };
  }

  const rules: DeckValidationRules = {
    defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES,
    uniqueCanonicalZones: ["battlefields"],
    cardPolicies: bannedServerPolicies,
    copyRules: [
      {
        zones: ["mainDeck", "champion", "sideboard"],
        maxCopiesPerCanonical: DEFAULT_MAX_COPIES
      },
      { zones: ["legend"], maxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zones: ["runes"], maxCopiesPerCanonical: RUNE_MAX_COPIES },
      {
        zones: ["battlefields"],
        maxCopiesPerCanonical: BATTLEFIELD_MAX_COPIES
      }
    ],
    sizeRules: {
      legend: { minimum: 1, maximum: 1 },
      champion: { minimum: 1, maximum: 1 },
      runes: { minimum: 12, maximum: 12 },
      battlefields: { minimum: 3, maximum: 3 },
      sideboard: { minimum: 0, maximum: 10 }
    },
    sizeGroups: [
      { zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }
    ]
  };

  const policy: ConstructedPublicPolicy = {
    format,
    checkedAt,
    banResolutionComplete: missingBannedTargets.length === 0,
    tournamentComplete: false,
    policyScope:
      "Bounded official Constructed policy: bans, deck/zone structure, Domain Identity, Champion Legend/tag and Signature limits; see limitations",
    limitations: POLICY_LIMITATIONS,
    sources: [RULES_HUB_SOURCE, CARD_SNAPSHOT_SOURCE],
    zoneRules: [
      {
        zone: "mainDeck",
        defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES
      },
      { zone: "legend", minimum: 1, maximum: 1, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zone: "champion", minimum: 1, maximum: 1, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zone: "runes", minimum: 12, maximum: 12, defaultMaxCopiesPerCanonical: RUNE_MAX_COPIES },
      {
        zone: "battlefields",
        minimum: 3,
        maximum: 3,
        defaultMaxCopiesPerCanonical: BATTLEFIELD_MAX_COPIES
      },
      { zone: "sideboard", minimum: 0, maximum: 10, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES }
    ],
    cardPolicies,
    printingPolicies,
    bannedTargets,
    missingBannedNames: missingBannedTargets.map(target => target.officialName),
    missingBannedTargets,
    standard: {
      legalSetCodes: radianceActive
        ? [...STANDARD_LEGAL_SET_CODES, RADIANCE_SET_CODE]
        : STANDARD_LEGAL_SET_CODES,
      radiance: {
        status: radianceActive ? "active" : "preview-not-released",
        effectiveDate: RADIANCE_EFFECTIVE_DATE,
        releaseDate: RADIANCE_RELEASE_DATE
      }
    }
  };

  return { rules, policy, identityMetadata };
}

export function getConstructedCardPolicy(
  policy: ConstructedPublicPolicy,
  canonicalCardId: string
): ConstructedCardPolicy | undefined {
  return policy.cardPolicies[canonicalCardId];
}

export function getConstructedPrintingPolicy(
  policy: ConstructedPublicPolicy,
  printingId: string
): ConstructedPrintingPolicy | undefined {
  return policy.printingPolicies[printingId];
}

interface ResolvedLegendIdentity {
  readonly championTag: string;
  readonly domains: readonly string[];
}

function identityIssue(
  code: DeckValidationIssue["code"],
  message: string,
  details: Omit<DeckValidationIssue, "code" | "message"> = {}
): DeckValidationIssue {
  return { code, message, ...details };
}

function formatList(values: readonly string[]): string {
  return `[${values.join(", ")}]`;
}

function displayName(
  cardNames: ReadonlyMap<string, string>,
  cardId: string
): string {
  return cardNames.get(cardId) ?? cardId;
}

/**
 * Resolves the Champion Legend and the Domain Identity it dictates
 * (CR 103.1 / 103.1.b.2). Returns no identity when the deck does not submit a
 * legend zone at all, so partial caches of the structural validator keep their
 * previous behaviour. Whenever a legend is submitted, unresolved or missing
 * catalog metadata is reported instead of being treated as legal.
 */
function resolveLegendIdentity(
  deck: DeckSubmission,
  identityMetadata: ConstructedIdentityMetadata,
  cardNames: ReadonlyMap<string, string>
): {
  readonly identity?: ResolvedLegendIdentity;
  readonly issues: readonly DeckValidationIssue[];
} {
  const entries = deck.legend ?? [];
  if (entries.length === 0) return { issues: [] };

  const issues: DeckValidationIssue[] = [];
  const legendTotal = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const distinctLegendIds = new Set(entries.map(entry => entry.cardId));
  if (distinctLegendIds.size !== 1 || legendTotal !== 1) {
    issues.push(identityIssue(
      "identity_metadata_unavailable",
      `无法确定唯一 Champion Legend（legend 区共 ${legendTotal} 张、${distinctLegendIds.size} 种），因此无法推导 Domain Identity（CR 103.1 / 103.1.b.2）。`
    ));
    return { issues };
  }

  const legendCardId = entries[0]?.cardId;
  const metadata = legendCardId === undefined
    ? undefined
    : identityMetadata.byCardId.get(legendCardId);
  const name = displayName(cardNames, legendCardId ?? "");
  if (legendCardId === undefined || metadata === undefined) {
    issues.push(identityIssue(
      "identity_metadata_unavailable",
      `缺少 Champion Legend ${name} (${legendCardId}) 的 catalog 身份元数据（domains/tags），无法校验 Domain Identity 与 champion tag。`,
      { cardId: legendCardId }
    ));
    return { issues };
  }

  if (!isLegendCardType(metadata.cardType)) {
    issues.push(identityIssue(
      "identity_metadata_unavailable",
      `legend 区的 ${name} (${legendCardId}) 的实际类型为 ${metadata.cardType}，不是 Legend，无法作为 Champion Legend（CR 103.1）。`,
      { cardId: legendCardId }
    ));
    return { issues };
  }

  if (metadata.domains.length === 0) {
    issues.push(identityIssue(
      "identity_metadata_unavailable",
      `Champion Legend ${name} (${legendCardId}) 的 catalog domains 为空，无法确定 Domain Identity（CR 103.1.b.2）；不会假定任何域。`,
      { cardId: legendCardId }
    ));
    return { issues };
  }

  const family = resolveChampionFamily(
    metadata.tags,
    identityMetadata.knownChampionTags
  );
  if (family.family === undefined) {
    issues.push(identityIssue(
      "identity_metadata_unavailable",
      family.usedLegacyFallback
        ? `Champion Legend ${name} (${legendCardId}) 的 tags ${formatList(metadata.tags)} 无法定名唯一的 champion tag（CR 103.2.a.2），不会把地区等额外 tag 当作匹配依据。`
        : `Champion Legend ${name} (${legendCardId}) 的 tags ${formatList(metadata.tags)} 与 catalog 已知 champion tag 名集的交集为 ${formatList(family.candidates)}，无法唯一确定 champion tag（CR 103.2.a.2 / 133.8.b），不会把 Yordle 等共同 tag 当作匹配依据。`,
      { cardId: legendCardId }
    ));
    return { issues };
  }

  return {
    identity: { championTag: family.family, domains: metadata.domains },
    issues: []
  };
}

function collectDomainIdentityIssues(
  deck: DeckSubmission,
  identity: ResolvedLegendIdentity,
  identityMetadata: ConstructedIdentityMetadata,
  cardNames: ReadonlyMap<string, string>
): readonly DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  for (const zone of DOMAIN_IDENTITY_ZONES) {
    for (const entry of deck[zone] ?? []) {
      const metadata = identityMetadata.byCardId.get(entry.cardId);
      const name = displayName(cardNames, entry.cardId);
      if (metadata === undefined) {
        issues.push(identityIssue(
          "identity_metadata_unavailable",
          `缺少 ${name} (${entry.cardId}) 的 catalog 身份元数据（domains/tags），无法校验其域是否属于 Champion Legend 的 Domain Identity。`,
          { cardId: entry.cardId, canonicalCardId: undefined, zone }
        ));
        continue;
      }
      if (metadata.domains.length === 0) continue;
      const requiredDomains = metadata.domains.filter(
        domain => domain !== COLORLESS_DOMAIN
      );
      // Colorless battlefields have no official Domain Identity semantics yet.
      if (requiredDomains.length === 0) continue;
      const missingDomains = [
        ...new Set(requiredDomains.filter(
          domain => !identity.domains.includes(domain)
        ))
      ];
      if (missingDomains.length === 0) continue;
      issues.push(identityIssue(
        "card_not_in_domain_identity",
        `${name} (${entry.cardId}) 的域 ${formatList(metadata.domains)} 未全部包含于 Champion Legend 的 Domain Identity ${formatList(identity.domains)}（缺少 ${formatList(missingDomains)}，CR 103.1.b.4）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone
        }
      ));
    }
  }
  return issues;
}

function collectChampionIssues(
  deck: DeckSubmission,
  identity: ResolvedLegendIdentity,
  identityMetadata: ConstructedIdentityMetadata,
  cardNames: ReadonlyMap<string, string>
): readonly DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  for (const entry of deck.champion ?? []) {
    const metadata = identityMetadata.byCardId.get(entry.cardId);
    const name = displayName(cardNames, entry.cardId);
    if (metadata === undefined) {
      issues.push(identityIssue(
        "identity_metadata_unavailable",
        `缺少 Chosen Champion ${name} (${entry.cardId}) 的 catalog 身份元数据（cardType/tags），无法校验其 champion tag。`,
        { cardId: entry.cardId, zone: "champion" }
      ));
      continue;
    }

    const isChampionUnit = isUnitCardType(metadata.cardType) &&
      hasTag(metadata.tags, CHAMPION_TAG_MARKER);
    const isSignature = hasTag(metadata.tags, SIGNATURE_TAG_MARKER);
    if (!isChampionUnit) {
      issues.push(identityIssue(
        isSignature ? "champion_is_signature" : "champion_not_champion_unit",
        isSignature
          ? `Signature 卡 ${name} (${entry.cardId}) 不是 champion unit，不能作为 Chosen Champion，即使其 tag 与 Champion Legend 匹配（CR 103.2.a.2 / 103.2.d.3）。`
          : `Chosen Champion ${name} (${entry.cardId}) 必须是带 Champion 标记的 Unit，实际为 ${metadata.cardType} / tags ${formatList(metadata.tags)}（CR 103.2.a.2）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone: "champion"
        }
      ));
      continue;
    }

    if (isSignature) {
      issues.push(identityIssue(
        "champion_is_signature",
        `Signature 卡 ${name} (${entry.cardId}) 不能放入 Champion 区（CR 103.2.d.3）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone: "champion"
        }
      ));
      continue;
    }

    const family = resolveChampionFamily(
      metadata.tags,
      identityMetadata.knownChampionTags
    );
    // A real named Champion unit whose own `name` is a known champion tag must
    // agree with the family its tags resolve to. When the catalog contradicts
    // itself (e.g. `Karma, Channeler` tagged `Vi`), report the unavailable
    // identity instead of quietly matching the unit to the wrong family.
    if (!family.usedLegacyFallback &&
        metadata.name !== undefined &&
        identityMetadata.knownChampionTags.has(metadata.name) &&
        family.family !== metadata.name) {
      issues.push(identityIssue(
        "identity_metadata_unavailable",
        `Chosen Champion ${name} (${entry.cardId}) 的 name "${metadata.name}" 是 catalog 已知 champion tag，但其 tags ${formatList(metadata.tags)} 推出的家族为 ${formatList(family.candidates)}，record 自相矛盾，无法确认其所匹配的 champion family（CR 103.2.a.2 / 133.8.b）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone: "champion"
        }
      ));
      continue;
    }

    // With a named champion source the match is decided by the resolved family
    // alone. 0 or 2+ catalog-known candidates stay unavailable even when the raw
    // tags happen to contain the chosen Legend's tag, so an ambiguous unit that
    // carries several named families (including the Legend's own) is rejected
    // instead of being silently accepted through a shared tag.
    if (!family.usedLegacyFallback && family.family === undefined) {
      issues.push(identityIssue(
        "identity_metadata_unavailable",
        `Chosen Champion ${name} (${entry.cardId}) 的 tags ${formatList(metadata.tags)} 与 catalog 已知 champion tag 名集的交集为 ${formatList(family.candidates)}，无法唯一确定其所匹配的 champion family（CR 103.2.a.2 / 133.8.b），不会按卡面共同 tag 放行。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone: "champion"
        }
      ));
      continue;
    }

    if (family.usedLegacyFallback) {
      // A legacy/synthetic catalog carries no named champion source at all, so
      // the original raw-tag rule is kept for those small fixtures.
      if (!hasTag(identityTags(metadata.tags), identity.championTag)) {
        issues.push(identityIssue(
          "champion_tag_mismatch",
          `Chosen Champion ${name} (${entry.cardId}) 的 champion tag ${formatList(identityTags(metadata.tags))} 与 Champion Legend 的 ${identity.championTag} 不匹配（CR 103.2.a.2）。`,
          {
            cardId: entry.cardId,
            canonicalCardId: metadata.canonicalCardId,
            zone: "champion"
          }
        ));
      }
      continue;
    }

    if (family.family !== identity.championTag) {
      issues.push(identityIssue(
        "champion_tag_mismatch",
        `Chosen Champion ${name} (${entry.cardId}) 的 champion family ${family.family} 与 Champion Legend 的 ${identity.championTag} 不匹配（CR 103.2.a.2）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone: "champion"
        }
      ));
    }
  }
  return issues;
}

function collectSignatureIssues(
  deck: DeckSubmission,
  identity: ResolvedLegendIdentity,
  identityMetadata: ConstructedIdentityMetadata,
  cardNames: ReadonlyMap<string, string>
): readonly DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  let signatureTotal = 0;
  for (const zone of SIGNATURE_COUNT_ZONES) {
    for (const entry of deck[zone] ?? []) {
      const metadata = identityMetadata.byCardId.get(entry.cardId);
      if (metadata === undefined) continue;
      if (!hasTag(metadata.tags, SIGNATURE_TAG_MARKER)) continue;
      signatureTotal += entry.quantity;
      const family = resolveChampionFamily(
        metadata.tags,
        identityMetadata.knownChampionTags
      );
      if (family.usedLegacyFallback) {
        if (hasTag(identityTags(metadata.tags), identity.championTag)) continue;
      } else if (family.family === undefined) {
        issues.push(identityIssue(
          "identity_metadata_unavailable",
          `Signature 卡 ${displayName(cardNames, entry.cardId)} (${entry.cardId}) 的 tags ${formatList(metadata.tags)} 与 catalog 已知 champion tag 名集的交集为 ${formatList(family.candidates)}，无法唯一确定 champion family（CR 103.2.d.2 / 133.8.b）。`,
          {
            cardId: entry.cardId,
            canonicalCardId: metadata.canonicalCardId,
            zone
          }
        ));
        continue;
      } else if (family.family === identity.championTag) {
        continue;
      }
      issues.push(identityIssue(
        "signature_tag_mismatch",
        `Signature 卡 ${displayName(cardNames, entry.cardId)} (${entry.cardId}) 的 champion tag ${formatList(identityTags(metadata.tags))} 与 Champion Legend 的 ${identity.championTag} 不匹配（CR 103.2.d.2）。`,
        {
          cardId: entry.cardId,
          canonicalCardId: metadata.canonicalCardId,
          zone
        }
      ));
    }
  }

  if (signatureTotal > SIGNATURE_MAX_TOTAL) {
    issues.push(identityIssue(
      "signature_limit_exceeded",
      `deck 内 Signature 卡合计 ${signatureTotal} 张，超过 ${SIGNATURE_MAX_TOTAL} 张上限（不限卡名，CR 103.2.d.1）。`
    ));
  }
  return issues;
}

function collectIdentityIssues(
  deck: DeckSubmission,
  constructed: ConstructedRules,
  cardNames: ReadonlyMap<string, string>
): readonly DeckValidationIssue[] {
  const identityMetadata = constructed.identityMetadata ?? {
    byCardId: new Map<string, ConstructedCardIdentityMetadata>(),
    knownChampionTags: new Set<string>()
  };
  const { identity, issues } = resolveLegendIdentity(
    deck,
    identityMetadata,
    cardNames
  );
  if (identity === undefined) return issues;

  return [
    ...issues,
    ...collectDomainIdentityIssues(deck, identity, identityMetadata, cardNames),
    ...collectChampionIssues(deck, identity, identityMetadata, cardNames),
    ...collectSignatureIssues(deck, identity, identityMetadata, cardNames)
  ];
}

export function validateConstructedDeck(
  deck: DeckSubmission,
  validationCards: readonly DeckCardDefinition[],
  constructed: ConstructedRules
): ConstructedValidationResult {
  const result = validateDeck(deck, validationCards, constructed.rules);
  const printingIssues: ConstructedPrintingIssue[] = [];
  const cardById = new Map(validationCards.map(card => [card.id, card]));
  const cardNames = new Map(validationCards.map(card => [card.id, card.name]));
  const identityIssues = collectIdentityIssues(deck, constructed, cardNames);
  const zones = [
    "mainDeck",
    "runes",
    "legend",
    "champion",
    "battlefields",
    "sideboard"
  ] as const;

  for (const zone of zones) {
    for (const entry of deck[zone] ?? []) {
      const printingPolicy = constructed.policy.printingPolicies[entry.cardId];
      if (printingPolicy === undefined || printingPolicy.available) continue;

      const card = cardById.get(entry.cardId);
      printingIssues.push({
        cardId: entry.cardId,
        canonicalCardId: card?.canonicalCardId,
        zone,
        status: printingPolicy.status,
        message: printingPolicy.status === "previewNotReleased"
          ? `Printing ${entry.cardId} is a Radiance preview printing and is not released as of ${constructed.policy.checkedAt}.`
          : printingPolicy.status === "banned"
            ? `Printing ${entry.cardId} belongs to a banned canonical card.`
            : `Printing ${entry.cardId} is not from a Standard-legal set.`
      });
    }
  }

  return {
    ...result,
    valid: result.valid &&
      printingIssues.length === 0 &&
      identityIssues.length === 0,
    issues: [...result.issues, ...identityIssues],
    printingIssues
  };
}
