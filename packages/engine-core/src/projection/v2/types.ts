import type {
  ChoiceRequest,
  Domain,
  LocationRef,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ZoneId,
} from '../../effects/contract.js';

/** A seat, or the privacy-restricted view used by spectators and replays. */
export type ProjectionViewer = PlayerId | 'spectator' | 'replay' | null;

/** Zones understood by the projection. Aliases are accepted at the input edge. */
export type ProjectionZone =
  | ZoneId
  | 'discard'
  | 'banish'
  | 'base'
  | 'board'
  | 'battlefield'
  | 'champion'
  | 'legend'
  | 'rune'
  | 'facedown'
  | 'main-deck'
  | 'runeDeck'
  | 'championZone'
  | 'legendZone'
  | 'runeZone';

/**
 * The projection deliberately accepts the small authoritative object shape used by
 * the new layers/chain code as well as plain fixtures. No protocol DTO is required.
 */
export interface ProjectionObjectInput {
  readonly ref?: ObjectRef;
  readonly id?: string;
  readonly objectId?: string;
  readonly instanceId?: string;
  readonly uid?: string;
  readonly zoneEntryId?: number;
  readonly physicalCardId?: string;
  readonly cardId?: string | null;
  readonly name?: string;
  readonly cost?: number | null;
  readonly speed?: string;
  readonly reaction?: boolean;
  readonly hiddenOnTurn?: number;
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly keywords?: readonly { readonly id: string; readonly value?: number }[];
  readonly owner?: PlayerId | null;
  readonly ownerPlayerId?: PlayerId | null;
  readonly controller?: PlayerId | null;
  readonly controllerPlayerId?: PlayerId | null;
  readonly zone?: ProjectionZone;
  readonly location?: LocationRef | null;
  readonly might?: number | null;
  readonly energy?: number | null;
  readonly power?: readonly Domain[] | null;
  readonly exhausted?: boolean;
  readonly damage?: number;
  readonly stunned?: boolean;
  readonly buffs?: number;
  readonly counters?: Readonly<Record<string, number>>;
  readonly attachedTo?: ObjectRef | null;
  readonly faceDown?: boolean;
  readonly hidden?: boolean;
  readonly isToken?: boolean;
  readonly [key: string]: unknown;
}

export type ProjectionObjectRefInput = ObjectRef | string | ProjectionObjectInput;

export interface ProjectionPlayerInput {
  readonly id?: PlayerId;
  readonly playerId?: PlayerId;
  readonly name?: string;
  readonly energy?: number;
  readonly power?: readonly Domain[];
  readonly score?: number;
  readonly points?: number;
  readonly xp?: number;
  readonly hand?: readonly ProjectionObjectRefInput[];
  readonly deck?: readonly ProjectionObjectRefInput[];
  readonly mainDeck?: readonly ProjectionObjectRefInput[];
  readonly runeDeck?: readonly ProjectionObjectRefInput[];
  readonly trash?: readonly ProjectionObjectRefInput[];
  readonly discard?: readonly ProjectionObjectRefInput[];
  readonly banishment?: readonly ProjectionObjectRefInput[];
  readonly banish?: readonly ProjectionObjectRefInput[];
  readonly champion?: readonly ProjectionObjectRefInput[];
  readonly championZone?: readonly ProjectionObjectRefInput[];
  readonly legend?: readonly ProjectionObjectRefInput[];
  readonly legendZone?: readonly ProjectionObjectRefInput[];
  readonly base?: readonly ProjectionObjectRefInput[];
  readonly board?: readonly ProjectionObjectRefInput[];
  readonly battlefield?: readonly ProjectionObjectRefInput[];
  readonly rune?: readonly ProjectionObjectRefInput[];
  readonly runeZone?: readonly ProjectionObjectRefInput[];
  readonly facedown?: readonly ProjectionObjectRefInput[];
  readonly [key: string]: unknown;
}

export interface ProjectionChainItemInput {
  readonly id?: string;
  readonly itemId?: string;
  readonly status?: 'pending' | 'finalized' | 'resolving' | 'resolved' | 'countered' | string;
  readonly controller?: PlayerId;
  readonly controllerPlayerId?: PlayerId;
  readonly player?: PlayerId;
  readonly source?: ProjectionObjectRefInput;
  readonly object?: ProjectionObjectRefInput;
  readonly targets?: readonly ProjectionObjectRefInput[];
  readonly choices?: readonly ProjectionChoiceInput[];
  readonly [key: string]: unknown;
}

/** Choice requests are engine-side copies of the frozen ChoiceRequest contract. */
export interface ProjectionChoiceInput {
  readonly id: string;
  readonly chooser?: PlayerId;
  readonly player?: PlayerId;
  readonly playerId?: PlayerId;
  readonly visibility?: ChoiceRequest<unknown>['visibility'];
  readonly prompt?: string;
  readonly type?: ChoiceRequest<unknown>['type'];
  readonly options?: readonly (ProjectionObjectRefInput | PlayerId | string)[];
  readonly min?: number;
  readonly max?: number;
  readonly [key: string]: unknown;
}

export type ProjectionVisibilityKind = 'reveal' | 'look' | 'show-off';

/** A live information grant. Expiry is kept as data so replay can reproduce it. */
export interface ProjectionVisibilityInput {
  readonly kind: ProjectionVisibilityKind;
  readonly objectIds?: readonly (ObjectRef | string)[];
  readonly objects?: readonly ProjectionObjectRefInput[];
  readonly player?: PlayerId;
  readonly viewers?: 'all' | readonly PlayerId[];
  readonly properties?: readonly string[];
  readonly active?: boolean;
  readonly duration?: unknown;
  readonly until?: unknown;
  readonly expiresAt?: unknown;
  readonly [key: string]: unknown;
}

export interface ProjectionStateInput {
  readonly players: readonly ProjectionPlayerInput[] | Readonly<Record<PlayerId, ProjectionPlayerInput>>;
  readonly objects?: readonly ProjectionObjectInput[] | Readonly<Record<string, ProjectionObjectInput>>;
  readonly chain?: readonly ProjectionChainItemInput[];
  readonly pendingChoices?: readonly ProjectionChoiceInput[];
  readonly choices?: readonly ProjectionChoiceInput[];
  readonly outstandingChoices?: readonly ProjectionChoiceInput[];
  readonly visibility?: readonly ProjectionVisibilityInput[];
  readonly visibilityWindows?: readonly ProjectionVisibilityInput[];
  readonly reveals?: readonly ProjectionVisibilityInput[];
  readonly looks?: readonly ProjectionVisibilityInput[];
  readonly showOff?: readonly ProjectionVisibilityInput[];
  readonly eventSeq?: number;
  readonly stateVersion?: number;
  readonly version?: number;
  readonly phase?: string;
  readonly turn?: unknown;
  readonly priorityPlayerId?: PlayerId | null;
  readonly focusPlayerId?: PlayerId | null;
  readonly [key: string]: unknown;
}

export type ProjectedVisibility = 'identity' | 'face-down';

export interface ProjectedObject {
  readonly id: string;
  readonly ref: ObjectRef;
  readonly zone: string;
  readonly zoneEntryId: number;
  readonly owner: PlayerId | null;
  readonly controller: PlayerId | null;
  readonly faceDown: boolean;
  readonly visibility: ProjectedVisibility;
  readonly location: LocationRef | null;
  readonly cardId?: string;
  readonly name?: string;
  readonly cost?: number | null;
  readonly speed?: string;
  readonly reaction?: boolean;
  readonly hiddenOnTurn?: number;
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly keywords?: readonly { readonly id: string; readonly value?: number }[];
  readonly might?: number | null;
  readonly energy?: number | null;
  readonly power?: readonly Domain[] | null;
  readonly exhausted?: boolean;
  readonly damage?: number;
  readonly stunned?: boolean;
  readonly buffs?: number;
  readonly counters?: Readonly<Record<string, number>>;
  readonly attachedTo?: ObjectRef | null;
  readonly isToken?: boolean;
  readonly shownProperties?: readonly string[];
}

export interface ProjectedZone {
  readonly count: number;
  /** Only identities visible to this viewer. Hidden cards are represented by no card fields. */
  readonly cards: readonly ProjectedObject[];
  readonly identitiesVisible: boolean;
  readonly orderKnown: boolean;
}

export interface ProjectedPlayer {
  readonly id: PlayerId;
  readonly name?: string;
  readonly energy?: number;
  readonly power?: readonly Domain[];
  readonly score?: number;
  readonly points?: number;
  readonly xp?: number;
  readonly handCount: number;
  readonly mainDeckCount: number;
  readonly deckCount: number;
  readonly runeDeckCount: number;
  readonly hand: ProjectedZone;
  readonly mainDeck: ProjectedZone;
  readonly deck: ProjectedZone;
  readonly runeDeck: ProjectedZone;
  readonly trash: ProjectedZone;
  readonly banishment: ProjectedZone;
  readonly championZone: ProjectedZone;
  readonly legendZone: ProjectedZone;
  readonly base: ProjectedZone;
  readonly board: ProjectedZone;
  readonly battlefield: ProjectedZone;
  readonly runeZone: ProjectedZone;
  readonly facedown: ProjectedZone;
}

export interface ProjectedChoiceRequest {
  readonly id: string;
  readonly chooser: PlayerId;
  readonly visibility: 'chooser-only';
  readonly prompt?: string;
  readonly type?: string;
  readonly options?: readonly (ProjectedObject | PlayerId | string)[];
  readonly min?: number;
  readonly max?: number;
}

export interface ProjectedChainItem {
  readonly id: string;
  readonly status: string;
  readonly controller: PlayerId | null;
  readonly source: ProjectedObject | null;
  readonly object: ProjectedObject | null;
  readonly targets: readonly ProjectedObject[];
}

export interface ProjectedEvent {
  readonly [key: string]: unknown;
}

export interface ProjectionV2 {
  readonly schemaVersion: 2;
  readonly viewer: ProjectionViewer;
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly phase?: string;
  readonly turn?: unknown;
  readonly priorityPlayerId?: PlayerId | null;
  readonly focusPlayerId?: PlayerId | null;
  readonly players: Readonly<Record<PlayerId, ProjectedPlayer>>;
  readonly objects: readonly ProjectedObject[];
  readonly chain: readonly ProjectedChainItem[];
  readonly choices: readonly ProjectedChoiceRequest[];
  readonly choice: ProjectedChoiceRequest | null;
  readonly visibility: readonly ProjectionVisibilityInput[];
  readonly events: readonly ProjectedEvent[];
}

export type { ObjectRef, ObjectSnapshot, PlayerId, ZoneId };

/** Friendly aliases for callers that prefer the architecture terminology. */
export type ProjectionState = ProjectionStateInput;
export type AuthoritativeProjectionState = ProjectionStateInput;
export type ProjectedState = ProjectionV2;
