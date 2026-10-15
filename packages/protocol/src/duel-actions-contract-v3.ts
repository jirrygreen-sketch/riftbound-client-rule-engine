// Public Duel P4 "actions" wire DTOs (projection profile `riftbound-duel-v3-actions-1`,
// command packet profile `duel-command-v3-actions-1`). No engine import; this module only
// describes the allowlisted public projection/command shapes and their exact guards.
//
// Scope (ADR: outputs/coordination/full-product-20261012/task-artifacts/duel-public-profile-reconciliation/ADR.md):
//   * P4 reuses the V3 permanent match DTO (`match.schemaVersion === 3`) but is a DISTINCT
//     projection profile and command packet profile.
//   * A guard PASS is never actor/window/timing/cost authority. It cannot prove IR, a legal
//     window, a current Might, a final cost, or a resolved source; the authenticated server
//     session must bind actor + selected profile and re-verify every rule/source proof.
//   * This module intentionally does not widen `isDuelCommandMessage`/`isDuelProjectionAny`
//     and does not register new messages in the shared index union. The parent task owns that
//     barrel/route wiring and that integration is NOT done here.
import {
  DUEL_PROJECTION_SCHEMA_V3,
  DUEL_RULESET_ID,
  isDuelCommand,
  isDuelProjectionV3,
  type DuelWireAction,
  type DuelWireCommand,
  type DuelWireMatchSetupV3,
  type DuelWirePlayingPlayerV3,
  type DuelWireMatchPlayingV3,
  type DuelWireRuneCost,
} from './duel-contract.js';

/** Projection profile for the P4 actions packet. `match.schemaVersion` stays 3 (reuses V3 permanents). */
export const DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 = 'riftbound-duel-v3-actions-1' as const;
/** Command packet profile tag; the server MUST check it equals the selected session profile. */
export const DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 = 'duel-command-v3-actions-1' as const;
/** Retired ADR name; never implemented and never accepted as an alias (kept for tests/audit). */
export const DUEL_PROJECTION_SCHEMA_V2_ACTIONS_REJECTED = 'riftbound-duel-v2-actions-1' as const;

type DuelActionBase = { readonly id: string; readonly label: string; readonly enabled: boolean; readonly reason?: string };
type DuelWirePerson = { readonly playerId: string; readonly displayName: string };

/** P4-only actions. The five legacy `DuelWireAction` kinds remain valid unchanged. */
export type DuelActionV3Actions1 = DuelWireAction |
  (DuelActionBase & { readonly kind: 'play-card'; readonly cardUID: string; readonly windowId: string }) |
  (DuelActionBase & { readonly kind: 'activate-ability'; readonly sourceObjectId: string;
    readonly abilityOptionId: string; readonly windowId: string }) |
  (DuelActionBase & { readonly kind: 'pass-priority'; readonly windowId: string }) |
  (DuelActionBase & { readonly kind: 'pass-focus'; readonly windowId: string }) |
  (DuelActionBase & { readonly kind: 'standard-move'; readonly windowId: string;
    readonly selectableUnitUIDs: readonly string[];
    readonly destinations: readonly { readonly locationId: string; readonly eligibleUnitUIDs: readonly string[] }[] }) |
  (DuelActionBase & { readonly kind: 'answer-pending-choice'; readonly choiceId: string }) |
  (DuelActionBase & { readonly kind: 'assign-combat-damage'; readonly choiceId: string }) |
  (DuelActionBase & { readonly kind: 'end-turn'; readonly windowId: string });

/**
 * P4 command union: the five legacy commands plus the eight new actions. Commands carry only
 * opaque selection tokens/UIDs and `expectedVersion`. They deliberately carry NO
 * Might/damage/proof/delta/actor/window-authority/state, so a command can never authorize
 * itself and can never hand-edit score or state.
 */
export type DuelWireCommandV3Actions1 = DuelWireCommand |
  { readonly type: 'play-card'; readonly cardUID: string; readonly windowId: string } |
  { readonly type: 'activate-ability'; readonly sourceObjectId: string;
    readonly abilityOptionId: string; readonly windowId: string } |
  { readonly type: 'pass-priority'; readonly windowId: string } |
  { readonly type: 'pass-focus'; readonly windowId: string } |
  { readonly type: 'standard-move'; readonly windowId: string;
    readonly unitUIDs: readonly string[]; readonly destinationLocationId: string } |
  { readonly type: 'answer-pending-choice'; readonly choiceId: string;
    readonly answers: readonly { readonly promptId: string; readonly optionIds: readonly string[] }[] } |
  { readonly type: 'assign-combat-damage'; readonly choiceId: string;
    readonly assignments: readonly { readonly unitObjectId: string; readonly amount: number }[] } |
  { readonly type: 'end-turn'; readonly windowId: string };

/** Explicit tagged envelope; `commandProfile` must equal the selected session packet profile. */
export interface DuelCommandMessageV3Actions1 {
  readonly type: 'duel-command';
  readonly commandProfile: typeof DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1;
  readonly requestId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelWireCommandV3Actions1;
}

export interface DuelWireChoicePromptV3Actions1 {
  readonly promptId: string;
  readonly kind: 'mode' | 'target' | 'destination' | 'optional-cost' | 'effect-choice';
  readonly minSelections: number;
  readonly maxSelections: number;
  /** option id is an opaque per-choice token mapped to a trusted object/location/option; label is display-only. */
  readonly options: readonly { readonly id: string; readonly label: string }[];
}
export type DuelPendingChoiceOwnerV3Actions1 =
  | { readonly active: true; readonly choiceId: string; readonly kind: 'play-choices' | 'effect-choices';
      readonly prompts: readonly DuelWireChoicePromptV3Actions1[] }
  | { readonly active: true; readonly choiceId: string; readonly kind: 'combat-allocation';
      readonly fieldLocationId: string; readonly side: 'attacker' | 'defender'; readonly budget: number;
      readonly targets: readonly { readonly unitObjectId: string; readonly lethalNeed: number }[] };
/** `null` = no pending choice; `{active:true}` = non-owner sees only that a choice exists. */
export type DuelPendingChoiceV3Actions1 = null | { readonly active: true } | DuelPendingChoiceOwnerV3Actions1;
export type DuelChainSummaryV3Actions1 =
  | { readonly active: false }
  | { readonly active: true; readonly itemCount: number; readonly pendingCount: number;
      /** Optional public card facts. Present only for the server-selected public-chain execution profile. */
      readonly cards?: readonly DuelPublicChainCardV3Actions1[] };
export interface DuelPublicChainCardV3Actions1 {
  readonly cardId: string;
  readonly controllerPlayerId: string;
  readonly status: 'pending' | 'finalized';
}
export type DuelExecutionSummaryV3Actions1 =
  | { readonly status: 'ready' }
  | { readonly status: 'pending' };

/**
 * P4 playing frame = the V3 frame plus chain/pendingChoice/execution. These are DATA contracts:
 * their presence here does NOT claim the server publicly supports/projects P4 yet.
 */
export interface DuelFrameV3Actions1 {
  readonly phase: 'awaiting-turn-start' | 'awaken' | 'beginning' | 'scoring' | 'channel' |
    'draw' | 'main' | 'ending' | 'expiration' | 'ended';
  readonly turnNumber: number;
  readonly turnPlayerId: string;
  readonly priorityPlayerId: string | null;
  readonly focusPlayerId: string | null;
  readonly stateOpen: boolean;
  readonly pendingPayment: null | { readonly active: true; readonly paymentId?: string; readonly resolvedCost?: DuelWireRuneCost };
  readonly chain: DuelChainSummaryV3Actions1;
  readonly pendingChoice: DuelPendingChoiceV3Actions1;
  readonly execution: DuelExecutionSummaryV3Actions1;
}
export interface DuelWireMatchPlayingV3Actions1 {
  readonly schemaVersion: 3;
  readonly rulesetId: typeof DUEL_RULESET_ID;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly roster: readonly [DuelWirePerson, DuelWirePerson];
  readonly turnOrder: readonly [string, string];
  readonly stage: 'playing';
  readonly players: readonly [DuelWirePlayingPlayerV3, DuelWirePlayingPlayerV3];
  readonly board: DuelWireMatchPlayingV3['board'];
  readonly resources: DuelWireMatchPlayingV3['resources'];
  readonly scoring: DuelWireMatchPlayingV3['scoring'];
  readonly frame: DuelFrameV3Actions1;
}
export type DuelWireMatchV3Actions1 = DuelWireMatchSetupV3 | DuelWireMatchPlayingV3Actions1;

export interface DuelProjectionV3Actions1 {
  readonly projectionSchema: typeof DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  readonly viewerPlayerId: string | null;
  readonly match: DuelWireMatchV3Actions1;
  readonly actions: readonly DuelActionV3Actions1[];
}
/** Projection is published through the existing {type:'duel-projection',roomId,projection} wrapper. */
export interface DuelProjectionMessageV3Actions1 {
  readonly type: 'duel-projection';
  readonly roomId: string;
  readonly projection: DuelProjectionV3Actions1;
}

const LEGACY_KINDS = ['mulligan', 'rune-energy', 'rune-power', 'gold-power', 'pay-pending'] as const;
const P4_KINDS = ['play-card', 'activate-ability', 'pass-priority', 'pass-focus', 'standard-move',
  'answer-pending-choice', 'assign-combat-damage', 'end-turn'] as const;
const V3_FRAME_KEYS = ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId', 'focusPlayerId',
  'stateOpen', 'pendingPayment'] as const;
const P4_FRAME_KEYS = [...V3_FRAME_KEYS, 'chain', 'pendingChoice', 'execution'] as const;

type Data = Record<string, unknown>;
/** Exact own enumerable data descriptors, plain prototype; rejects getters, symbols, extras. */
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const keys = Reflect.ownKeys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => {
    if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor;
  });
}
/** Dense array with no extra/symbol/accessor keys (own keys are exactly length + indices). */
function array(value: unknown, length?: number): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      (length !== undefined && value.length !== length) ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) return false;
  }
  return true;
}
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function id(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function count(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function positive(value: unknown): value is number { return count(value, 1); }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function ids(raw: unknown): raw is readonly string[] { return array(raw) && raw.every(id) && unique(raw as string[]); }
function isKind(value: unknown, kinds: readonly string[]): value is string {
  return typeof value === 'string' && kinds.includes(value);
}
function seatList(match: Data): [string, string] | null {
  if (!array(match.roster, 2)) return null;
  const seats = (match.roster as readonly Data[]).map(person => person.playerId);
  if (!seats.every(id) || !unique(seats as string[])) return null;
  return seats as [string, string];
}
function boardLocations(match: Data): readonly string[] | null {
  const board = match.board;
  if (!record(board) || !array(board.bases) || !array(board.battlefields)) return null;
  const locations = [...(board.bases as readonly Data[]), ...(board.battlefields as readonly Data[])]
    .map(entry => entry.locationId);
  return locations.every(id) ? (locations as string[]) : null;
}

// --- P4 action shape/bounds (structure only; no rule/window authority) ---
function p4ActionKeys(raw: Data, kind: string): boolean {
  switch (kind) {
    case 'play-card':
      return exact(raw, ['id', 'kind', 'label', 'enabled', 'cardUID', 'windowId'], ['reason']);
    case 'activate-ability':
      return exact(raw, ['id', 'kind', 'label', 'enabled', 'sourceObjectId', 'abilityOptionId', 'windowId'], ['reason']);
    case 'pass-priority': case 'pass-focus': case 'end-turn':
      return exact(raw, ['id', 'kind', 'label', 'enabled', 'windowId'], ['reason']);
    case 'standard-move':
      return exact(raw, ['id', 'kind', 'label', 'enabled', 'windowId', 'selectableUnitUIDs', 'destinations'], ['reason']);
    case 'answer-pending-choice': case 'assign-combat-damage':
      return exact(raw, ['id', 'kind', 'label', 'enabled', 'choiceId'], ['reason']);
    default:
      return false;
  }
}
function moveDestination(raw: unknown, locations: readonly string[]): boolean {
  return exact(raw, ['locationId', 'eligibleUnitUIDs']) && id(raw.locationId) &&
    locations.includes(raw.locationId as string) && ids(raw.eligibleUnitUIDs);
}
function p4ActionOk(raw: unknown, match: Data): boolean {
  if (!record(raw) || !isKind(raw.kind, P4_KINDS) || !p4ActionKeys(raw, raw.kind)) return false;
  if (!id(raw.id) || !id(raw.label) || typeof raw.enabled !== 'boolean' ||
      (Object.hasOwn(raw, 'reason') && !id(raw.reason))) return false;
  switch (raw.kind) {
    case 'play-card':
      return id(raw.cardUID) && id(raw.windowId);
    case 'activate-ability':
      return id(raw.sourceObjectId) && id(raw.abilityOptionId) && id(raw.windowId);
    case 'pass-priority': case 'pass-focus': case 'end-turn':
      return id(raw.windowId);
    case 'standard-move': {
      if (!id(raw.windowId) || !ids(raw.selectableUnitUIDs) || !array(raw.destinations)) return false;
      const locations = boardLocations(match);
      if (locations === null) return false;
      const destinations = raw.destinations as readonly Data[];
      return destinations.every(entry => moveDestination(entry, locations)) &&
        unique(destinations.map(entry => entry.locationId as string));
    }
    default:
      return id(raw.choiceId);
  }
}

// --- P4 frame summaries ---
function choiceOptions(raw: unknown): boolean {
  return exact(raw, ['id', 'label']) && id(raw.id) && id(raw.label);
}
function choicePrompt(raw: unknown): boolean {
  if (!exact(raw, ['promptId', 'kind', 'minSelections', 'maxSelections', 'options']) || !id(raw.promptId) ||
      !isKind(raw.kind, ['mode', 'target', 'destination', 'optional-cost', 'effect-choice']) ||
      !count(raw.minSelections) || !count(raw.maxSelections) ||
      (raw.minSelections as number) > (raw.maxSelections as number) ||
      !array(raw.options) || (raw.options as readonly unknown[]).length === 0) return false;
  const options = raw.options as readonly Data[];
  return (raw.maxSelections as number) <= options.length && options.every(choiceOptions) &&
    unique(options.map(option => option.id as string));
}
function combatTarget(raw: unknown, seats: readonly [string, string]): boolean {
  return exact(raw, ['unitObjectId', 'lethalNeed']) && id(raw.unitObjectId) &&
    !seats.includes(raw.unitObjectId as string) && positive(raw.lethalNeed);
}
function pendingChoiceOk(raw: unknown, viewer: string | null, seats: readonly [string, string]): boolean {
  if (raw === null) return true;
  if (exact(raw, ['active']) && raw.active === true) return true; // non-owner/spectator summary
  if (!record(raw) || viewer === null) return false; // owner variant requires an authenticated viewer
  if (raw.kind === 'play-choices' || raw.kind === 'effect-choices') {
    if (!exact(raw, ['active', 'choiceId', 'kind', 'prompts']) || raw.active !== true || !id(raw.choiceId) ||
        !array(raw.prompts) || (raw.prompts as readonly unknown[]).length === 0) return false;
    const prompts = raw.prompts as readonly Data[];
    return prompts.every(choicePrompt) && unique(prompts.map(prompt => prompt.promptId as string));
  }
  if (raw.kind === 'combat-allocation') {
    if (!exact(raw, ['active', 'choiceId', 'kind', 'fieldLocationId', 'side', 'budget', 'targets']) ||
        raw.active !== true || !id(raw.choiceId) || !id(raw.fieldLocationId) ||
        (raw.side !== 'attacker' && raw.side !== 'defender') || !count(raw.budget) ||
        !array(raw.targets)) return false;
    const targets = raw.targets as readonly Data[];
    return targets.every(target => combatTarget(target, seats)) &&
      unique(targets.map(target => target.unitObjectId as string));
  }
  return false;
}
function chainOk(raw: unknown, seats: readonly [string, string]): boolean {
  if (exact(raw, ['active']) && raw.active === false) return true;
  if (!exact(raw, ['active', 'itemCount', 'pendingCount'], ['cards']) || raw.active !== true ||
      !positive(raw.itemCount) || !count(raw.pendingCount) || (raw.pendingCount as number) > (raw.itemCount as number)) return false;
  if (!Object.hasOwn(raw, 'cards')) return true;
  if (!array(raw.cards) || (raw.cards as readonly unknown[]).length !== raw.itemCount) return false;
  const cards = raw.cards as readonly Data[];
  let pending = 0;
  for (const card of cards) {
    if (!exact(card, ['cardId', 'controllerPlayerId', 'status']) || !id(card.cardId) ||
        !id(card.controllerPlayerId) || !seats.includes(card.controllerPlayerId as string) ||
        (card.status !== 'pending' && card.status !== 'finalized')) return false;
    if (card.status === 'pending') pending++;
  }
  return pending === raw.pendingCount;
}
function executionOk(raw: unknown): boolean {
  return exact(raw, ['status']) && (raw.status === 'ready' || raw.status === 'pending');
}

/** Strict public Chain summary guard used by the projection validator and focused contract tests. */
export function isDuelPublicChainSummaryV3Actions1(raw: unknown,
  seats: readonly [string, string]): raw is DuelChainSummaryV3Actions1 {
  return chainOk(raw, seats);
}

/** True when the playing frame is exactly the V3 frame plus chain/pendingChoice/execution. */
function p4FrameOk(raw: unknown, viewer: string | null, seats: readonly [string, string]): boolean {
  if (!exact(raw, [...P4_FRAME_KEYS])) return false;
  if (!chainOk(raw.chain, seats)) return false;
  const chain = raw.chain as Data;
  if (chain.active === true && raw.stateOpen === true) return false; // a chain implies Closed
  return pendingChoiceOk(raw.pendingChoice, viewer, seats) && executionOk(raw.execution);
}
/** Copy only the seven V3 frame keys so the V3 base guard can validate them. */
function v3FrameView(frame: Data): Data {
  const view: Data = {};
  for (const key of V3_FRAME_KEYS) view[key] = frame[key];
  return view;
}

/**
 * Reuse the V3 base guard for the entire match body: build a synthetic V3 projection whose
 * playing frame carries only the seven V3 keys and whose actions are the legacy subset. This
 * keeps the P4 base shape provably identical to V3 and avoids a divergent re-implementation.
 * `actions` here must only contain the five legacy kinds (the V3 guard rejects P4 kinds).
 */
function p4BaseOk(match: Data, viewer: string | null, legacyActions: readonly unknown[]): boolean {
  if (!exact(match, ['schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
    'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'stage'],
    ['setup', 'players', 'board', 'resources', 'scoring', 'frame'])) return false;
  let matchView: Data = match;
  if (match.stage === 'playing') {
    if (!record(match.frame)) return false;
    matchView = { ...match, frame: v3FrameView(match.frame as Data) };
  }
  return isDuelProjectionV3({ projectionSchema: DUEL_PROJECTION_SCHEMA_V3, viewerPlayerId: viewer,
    match: matchView, actions: legacyActions });
}

/**
 * Exact guard for the P4 projection. Requires `projectionSchema === riftbound-duel-v3-actions-1`,
 * `match.schemaVersion === 3`, no permanent fields in setup, V3 legends/gears in playing, and
 * the frame extensions chain/pendingChoice/execution. Rejects the retired `v2-actions-1` name,
 * any schemaVersion 2 shape, and P3 (no extra frame fields). A pass is structural only.
 */
export function isDuelProjectionV3Actions1(raw: unknown): raw is DuelProjectionV3Actions1 {
  if (!exact(raw, ['projectionSchema', 'viewerPlayerId', 'match', 'actions']) ||
      raw.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ||
      (raw.viewerPlayerId !== null && !id(raw.viewerPlayerId)) || !array(raw.actions)) return false;
  const viewer = raw.viewerPlayerId as string | null;
  if (!record(raw.match)) return false;
  const match = raw.match;
  if (match.schemaVersion !== 3) return false; // no schemaVersion-2 mixing, no numeric-schema fallback
  const seats = seatList(match);
  if (seats === null || (viewer !== null && !seats.includes(viewer))) return false;
  for (const action of raw.actions) {
    if (!record(action) || !isKind(action.kind, [...LEGACY_KINDS, ...P4_KINDS])) return false;
  }
  const legacyActions = raw.actions.filter(action => isKind((action as Data).kind, LEGACY_KINDS));
  if (!p4BaseOk(match, viewer, legacyActions)) return false;
  if (match.stage === 'playing' && !p4FrameOk(match.frame, viewer, seats)) return false;
  // Action visibility/emptiness mirrors the base guard; P4 kinds are validated separately.
  if (viewer === null && raw.actions.length !== 0) return false;
  if (match.stage === 'setup') {
    const setup = match.setup as Data;
    if (setup.stage === 'complete' && raw.actions.length !== 0) return false;
    if (setup.stage === 'mulligan' && setup.currentMulliganOwner !== viewer && raw.actions.length !== 0) return false;
  }
  if (match.stage === 'playing') {
    const phase = (match.frame as Data).phase;
    if ((phase === 'ended' || phase === 'awaiting-turn-start') && raw.actions.length !== 0) return false;
  }
  const actionIds = new Set<string>();
  for (const action of raw.actions) {
    const kind = (action as Data).kind as string;
    if (!LEGACY_KINDS.includes(kind as never) && !p4ActionOk(action, match)) return false;
    const idValue = (action as Data).id as string;
    if (actionIds.has(idValue)) return false;
    actionIds.add(idValue);
  }
  return true;
}

/** Projection message guard for the existing {type:'duel-projection',roomId,projection} envelope. */
export function isDuelProjectionMessageV3Actions1(raw: unknown): raw is DuelProjectionMessageV3Actions1 {
  return exact(raw, ['type', 'roomId', 'projection']) && raw.type === 'duel-projection' &&
    id(raw.roomId) && isDuelProjectionV3Actions1(raw.projection);
}

// --- P4 command shapes ---
function p4Command(raw: Data): boolean {
  if (!isKind(raw.type, P4_KINDS)) return false;
  switch (raw.type) {
    case 'play-card':
      return exact(raw, ['type', 'cardUID', 'windowId']) && id(raw.cardUID) && id(raw.windowId);
    case 'activate-ability':
      return exact(raw, ['type', 'sourceObjectId', 'abilityOptionId', 'windowId']) &&
        id(raw.sourceObjectId) && id(raw.abilityOptionId) && id(raw.windowId);
    case 'pass-priority': case 'pass-focus': case 'end-turn':
      return exact(raw, ['type', 'windowId']) && id(raw.windowId);
    case 'standard-move': {
      if (!exact(raw, ['type', 'windowId', 'unitUIDs', 'destinationLocationId']) || !id(raw.windowId) ||
          !ids(raw.unitUIDs) || (raw.unitUIDs as readonly unknown[]).length === 0 ||
          !id(raw.destinationLocationId)) return false;
      return !(raw.unitUIDs as readonly string[]).includes(raw.destinationLocationId as string);
    }
    case 'answer-pending-choice': {
      if (!exact(raw, ['type', 'choiceId', 'answers']) || !id(raw.choiceId) || !array(raw.answers)) return false;
      const answers = raw.answers as readonly Data[];
      return answers.every(answer => exact(answer, ['promptId', 'optionIds']) &&
        id(answer.promptId) && ids(answer.optionIds)) &&
        unique(answers.map(answer => answer.promptId as string));
    }
    default: { // assign-combat-damage
      if (!exact(raw, ['type', 'choiceId', 'assignments']) || !id(raw.choiceId) || !array(raw.assignments)) return false;
      const assignments = raw.assignments as readonly Data[];
      return assignments.every(assignment => exact(assignment, ['unitObjectId', 'amount']) &&
        id(assignment.unitObjectId) && positive(assignment.amount)) &&
        unique(assignments.map(assignment => assignment.unitObjectId as string));
    }
  }
}

/**
 * Exact guard for P4 commands: the five legacy commands keep their existing shape
 * (`isDuelCommand`), and the eight new actions accept only opaque tokens. Any
 * Might/damage/proof/delta/actor/state key fails (fail-closed exact keys).
 */
export function isDuelCommandV3Actions1(raw: unknown): raw is DuelWireCommandV3Actions1 {
  if (!record(raw) || !id(raw.type)) return false;
  if (isDuelCommand(raw)) return true;
  return p4Command(raw);
}
/** Tagged packet guard; `commandProfile` must equal the P4 profile and the command must be exact. */
export function isDuelCommandMessageV3Actions1(raw: unknown): raw is DuelCommandMessageV3Actions1 {
  if (!exact(raw, ['type', 'commandProfile', 'requestId', 'commandId', 'expectedVersion', 'command'])) return false;
  return raw.type === 'duel-command' && raw.commandProfile === DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 &&
    id(raw.requestId) && id(raw.commandId) && count(raw.expectedVersion) &&
    isDuelCommandV3Actions1(raw.command);
}
