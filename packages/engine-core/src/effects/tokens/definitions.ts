import type { TokenSpec } from "../contract.js";

/** Default readiness for a newly created permanent. `null` means the type has no unit/gear entry rule. */
export type TokenEntryState = "ready" | "exhausted" | null;

/** How the token's own printed ability is carried, if it has one. */
export type TokenAbilityBinding =
  | "none"
  | "canonical-card-program"
  | "effect-expanded"
  | "blocked";

export interface TokenDefinition {
  readonly id: string;
  readonly spec: TokenSpec;
  /** Core Rules v1.5 187.x and any type-specific entry rule. */
  readonly ruleRefs: readonly string[];
  /** State implied by the token's type before a creating effect overrides it (CR 143.4/359.2.d). */
  readonly defaultEntry: TokenEntryState;
  readonly abilityBinding: TokenAbilityBinding;
  readonly blockedReason?: string;
}

const unit = (name: string, might: number, tags: readonly string[] = [], extra: Partial<TokenSpec> = {}): TokenSpec => ({
  cardId: null,
  name,
  types: ["unit"],
  tags,
  keywords: [],
  might,
  energy: null,
  power: null,
  ...extra
});

const blockedBattlefield = "token-battlefield-creation-requires-location-contract";
const blockedGold = "token-definition-or-abilities-judge-required";

const definitions = [
  {
    id: "recruit",
    spec: unit("Recruit", 1, ["Recruit"]),
    ruleRefs: ["187.1", "185.3.a", "143.4"],
    defaultEntry: "exhausted",
    abilityBinding: "none"
  },
  {
    id: "sprite",
    spec: unit("Sprite", 3, ["Fae"], {
      cardId: "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef",
      keywords: [{ id: "Temporary" }]
    }),
    ruleRefs: ["187.2", "185.3.a", "143.4", "816.1"],
    defaultEntry: "exhausted",
    // Temporary is represented as a printed keyword, but the lifecycle
    // binding for a token incarnation is not installed by the host yet. Keep
    // creation fail-closed rather than materializing a permanent that silently
    // loses its Beginning-Phase self-kill.
    abilityBinding: "blocked",
    blockedReason: blockedGold
  },
  {
    id: "sand-soldier",
    spec: unit("Sand Soldier", 2, ["Shurima"]),
    ruleRefs: ["187.3", "185.3.a", "143.4"],
    defaultEntry: "exhausted",
    abilityBinding: "none"
  },
  {
    id: "mech",
    spec: unit("Mech", 3, ["Mech"]),
    ruleRefs: ["187.4", "185.3.a", "143.4"],
    defaultEntry: "exhausted",
    abilityBinding: "none"
  },
  {
    id: "gold",
    spec: {
      cardId: "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511",
      name: "Gold",
      types: ["gear"],
      tags: [],
      keywords: [{ id: "Reaction" }],
      might: null,
      energy: null,
      power: null
    },
    ruleRefs: ["187.5", "185.3.a", "149.1", "359.2.d"],
    defaultEntry: "ready",
    // The canonical Gold program remains judge-required for Universal Power.
    // The definition is visible for projection/definition evidence, but token
    // creation stays fail-closed until that intrinsic ability is executable.
    abilityBinding: "blocked",
    blockedReason: blockedGold
  },
  {
    id: "reflection",
    spec: unit("Reflection", 0, [], {
      cardId: "card.hash-7538c2135b030e4e91c01e4952055324c62e0182b94d2d0bf0c272f7f55e2373"
    }),
    ruleRefs: ["187.6", "185.3.a", "143.4"],
    defaultEntry: "exhausted",
    abilityBinding: "none"
  },
  {
    id: "bird",
    spec: unit("Bird", 1, ["Bird"], {
      cardId: "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d",
      keywords: [{ id: "Deflect" }]
    }),
    ruleRefs: ["187.7", "185.3.a", "143.4", "809.1.b.3"],
    defaultEntry: "exhausted",
    // Deflect is preserved as a printed keyword, but a token incarnation does
    // not yet enter program/static lifecycle in every host. Do not create a
    // token that would silently lose its mandatory target tax.
    abilityBinding: "blocked",
    blockedReason: blockedGold
  },
  {
    id: "brush",
    spec: {
      cardId: "card.hash-8624ca0fcb3cd60db66cadac14c3f88e0dc422d1061843d35d39845b60616015",
      name: "Brush",
      types: ["battlefield"],
      tags: [],
      keywords: [],
      might: null,
      energy: null,
      power: null
    },
    ruleRefs: ["187.8", "185.3.a"],
    defaultEntry: null,
    abilityBinding: "blocked",
    blockedReason: blockedBattlefield
  },
  {
    id: "baron-pit",
    spec: {
      cardId: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
      name: "Baron Pit",
      types: ["battlefield"],
      tags: [],
      keywords: [],
      might: null,
      energy: null,
      power: null
    },
    ruleRefs: ["187.9", "185.3.a"],
    defaultEntry: null,
    abilityBinding: "blocked",
    blockedReason: blockedBattlefield
  },
  {
    id: "tentacle",
    spec: unit("Tentacle", 1, ["Bilgewater"]),
    ruleRefs: ["187.10", "185.3.a", "143.4"],
    defaultEntry: "exhausted",
    abilityBinding: "none"
  },
  {
    id: "shadow-clone",
    spec: unit("Shadow Clone", 0),
    ruleRefs: ["187.11", "185.3.a", "143.4", "807"],
    defaultEntry: "exhausted",
    abilityBinding: "blocked",
    blockedReason: blockedGold
  },
  {
    id: "bomb",
    spec: {
      cardId: null,
      name: "Bomb",
      types: ["gear"],
      tags: [],
      keywords: [{ id: "Deploy" }, { id: "Deathknell" }],
      might: null,
      energy: null,
      power: null
    },
    ruleRefs: ["187.12", "185.3.a", "149.1", "359.2.d", "808", "830"],
    defaultEntry: "ready",
    abilityBinding: "blocked",
    blockedReason: blockedGold
  }
] as const satisfies readonly TokenDefinition[];

const byId: ReadonlyMap<string, TokenDefinition> = new Map(
  definitions.map(definition => [definition.id, definition] as const)
);

/** The complete CR v1.5 187.1-187.12 fixed token catalog. */
export const TOKEN_DEFINITIONS: readonly TokenDefinition[] = definitions;

export function getTokenDefinition(id: string): TokenDefinition | undefined {
  return byId.get(id);
}

