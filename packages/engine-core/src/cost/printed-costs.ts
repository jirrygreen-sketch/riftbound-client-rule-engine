// Printed base-cost binding for Duel cards, CR v1.4 135.2.e.5 / 135.2.e.6, read against the
// "Determine Total Cost" / "Pay the card's costs" flow (356 base cost, 357 combined Energy + Power).
//
// Scope boundary (do not widen it):
//   - This module only reads the card's PRINTED BASE cost (135.2.e / 356.1.c "Printed Base Cost").
//   - It never decides cost modifications (356.1 "play for", 356.1.b "ignore", 356.2 additional
//     costs, 356.3 increases, 356.4 discounts, 356.5 total-cost rewrites, 356.6 floors).
//   - It never decides targets (358.1), ability costs, or permission to play a card. Those live in an
//     outer IR and must be resolved before any cost is offered for payment.
//   - A `numeric` binding therefore does NOT mean "this card is fully payable or resolved". A card
//     with an ability may still owe additional/non-standard costs that this module cannot see.
//   - The trusted input is a SERVER catalog projection. A client card is never authoritative; the
//     later registry is built from the server catalog, and payPending only references a server-bound
//     cost plus payment ID.
//
// The resources module stays the single authority for DuelRuneCost, the six Domains, and the real
// payDuelRuneCost kernel; nothing about resource payment is re-implemented here.
import { DUEL_DOMAINS, type DuelDomain, type DuelPowerRequirement, type DuelRuneCost } from './resources.js';

/** Card types that can carry a normal printed play cost. Rune/Legend/Battlefield/Token never do. */
const PLAYABLE_CARD_TYPES = Object.freeze(['Unit', 'Gear', 'Spell'] as const);
/** Literal no-Domain marker used by the catalog for Domainless cards. It is not a seventh Domain. */
const COLORLESS_MARKER = 'Colorless';

export type DuelPrintedCostReason = 'unsupported-card-type' | 'no-printed-energy';

export interface DuelPrintedCostNumeric {
  readonly kind: 'numeric';
  readonly cardId: string;
  readonly cost: DuelRuneCost;
}
export interface DuelPrintedCostUnsupported {
  readonly kind: 'not-played';
  readonly cardId: string;
  readonly reason: DuelPrintedCostReason;
}
/** Discriminated union: `numeric` has a payable printed base cost, `not-played` does not. */
export type DuelPrintedCostBinding = DuelPrintedCostNumeric | DuelPrintedCostUnsupported;

/**
 * Trusted catalog shape this module understands. Extra real catalog fields (`might`, `tags`, `name`,
 * `canonicalCardId`, ...) are allowed and ignored; unknown extras are never an error. `might` is NEVER
 * read as a cost (135.2.e.3: Might is a combat attribute, not an Energy or Power cost).
 */
export interface DuelPrintedCostCatalogCard {
  readonly id: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly energy: number | null;
  readonly power: number | null;
}

function fail(message: string): never { throw new TypeError(`Duel printed cost: ${message}`); }
function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain record`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label} must be a plain record`);
  return value as Record<string, unknown>;
}
function denseStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(k => k !== 'length' &&
      (typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= value.length))) fail(`${label} must be dense without extra keys`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0) fail(`${label}[${index}] must be a nonempty string`);
    return item;
  });
}
function printedCostNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') fail(`${label} must be a nonnegative safe integer, not ${value === undefined ? 'undefined' : typeof value}`);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative safe integer`);
  return value;
}
function sixDomains(): readonly DuelDomain[] { return [...DUEL_DOMAINS]; }

/**
 * Resolve the Domain requirement set of a printed [C]/[A] Power component.
 *  - domainless ([] or the literal `Colorless` marker) is processed as [A]: all six Domains
 *    (135.2.e.6.b).
 *  - a single/multi-Domain card is processed as any Power of that card's Domains (135.2.e.6.a/.c):
 *    one allowedDomains requirement, never a scalar total.
 * Unknown labels, duplicates, and `Colorless` mixed with colored Domains are rejected, never guessed.
 */
function printedDomains(value: unknown): readonly DuelDomain[] {
  const labels = denseStringArray(value, 'domains');
  if (labels.length === 0) return sixDomains();
  const colorlessCount = labels.filter(label => label === COLORLESS_MARKER).length;
  if (colorlessCount > 0) {
    if (labels.length !== 1) fail('Colorless cannot be combined with colored Domains');
    return sixDomains();
  }
  const seen = new Set<string>();
  return labels.map(label => {
    if (!(DUEL_DOMAINS as readonly string[]).includes(label)) fail(`unknown Domain label: ${label}`);
    if (seen.has(label)) fail(`duplicate Domain label: ${label}`);
    seen.add(label);
    return label as DuelDomain;
  });
}

/**
 * Bind a trusted catalog card to its printed base cost.
 *
 * - Unit/Gear/Spell with a printed Energy cost -> numeric `{ cardId, cost }`, where Energy is the
 *   literal number (a literal 0 is a legal numeric 0, 135.2.e is not "free by omission") and Power is
 *   a single allowedDomains requirement of `power` when `power > 0`, omitted when `power` is null or 0.
 * - `energy: null` is NOT free 0. Real Unit/Gear null-Energy printings are Recruit/Sprite/Bird/
 *   Reflection/Gold tokens created by effects; they are not normal-castable, so this returns
 *   `not-played` with `no-printed-energy` and the Creation instruction owns them.
 * - Rune/Legend/Battlefield/Token (and any non-Unit/Gear/Spell literal cardType) -> `not-played`
 *   with `unsupported-card-type`. This does not claim any complete card-type capability map.
 * - Malformed printed numbers (negative, fractional, NaN, Infinity, unsafe-integer/overflow, string,
 *   undefined) and malformed Domain lists throw. Rejection is atomic: the input card is never mutated
 *   and no partial binding is produced.
 *
 * The returned cost is a fresh deep copy: it never aliases or mutates the raw catalog data.
 */
export function bindDuelPrintedCost(card: DuelPrintedCostCatalogCard): DuelPrintedCostBinding {
  const raw = plainRecord(card, 'catalog card');
  if (typeof raw.id !== 'string' || raw.id.length === 0) fail('card id must be a nonempty string');
  const cardId = raw.id;
  if (typeof raw.cardType !== 'string' || raw.cardType.length === 0) fail('cardType must be a nonempty string');
  if (!PLAYABLE_CARD_TYPES.some(type => type === raw.cardType)) {
    return { kind: 'not-played', cardId, reason: 'unsupported-card-type' };
  }
  if (raw.energy === null) return { kind: 'not-played', cardId, reason: 'no-printed-energy' };
  const energy = printedCostNumber(raw.energy, 'printed Energy');
  const allowedDomains = printedDomains(raw.domains);
  const power = raw.power === null ? 0 : printedCostNumber(raw.power, 'printed Power');
  const total = energy + power;
  if (!Number.isSafeInteger(total)) fail('printed Energy + Power overflows safe integers');
  const powerCost: readonly DuelPowerRequirement[] =
    power === 0 ? [] : [{ allowedDomains: [...allowedDomains], amount: power }];
  return { kind: 'numeric', cardId, cost: { energy, power: powerCost } };
}

/**
 * Bind a whole trusted catalog snapshot into a registry keyed by PRINTING id (`card.id`).
 * The canonical identity is never substituted for the source printing id. A single
 * unsupported/token card produces its own `not-played` entry and never fails the whole batch.
 * Duplicate printing ids are rejected. This is an internal registry, not a PublicCommand: a later
 * payPending flow only references a server-bound cost and payment ID, never a client-supplied cost.
 */
export function bindDuelPrintedCostRegistry(
  cards: readonly DuelPrintedCostCatalogCard[],
): Map<string, DuelPrintedCostBinding> {
  if (!Array.isArray(cards)) fail('cards must be an array');
  const registry = new Map<string, DuelPrintedCostBinding>();
  for (const card of cards) {
    const binding = bindDuelPrintedCost(card);
    if (registry.has(binding.cardId)) fail(`duplicate printing ID: ${binding.cardId}`);
    registry.set(binding.cardId, binding);
  }
  return registry;
}
