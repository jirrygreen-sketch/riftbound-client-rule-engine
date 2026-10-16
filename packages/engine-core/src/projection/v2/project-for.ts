import type {
  ObjectRef,
  PlayerId,
  ProjectionChainItemInput,
  ProjectionChoiceInput,
  ProjectionObjectInput,
  ProjectionObjectRefInput,
  ProjectionPlayerInput,
  ProjectionStateInput,
  ProjectionViewer,
  ProjectionVisibilityInput,
  ProjectedChainItem,
  ProjectedChoiceRequest,
  ProjectedEvent,
  ProjectedObject,
  ProjectedPlayer,
  ProjectedZone,
  ProjectionV2,
} from './types.js';

type AnyRecord = Record<string, unknown>;
type CanonicalZone =
  | 'hand' | 'deck' | 'runeDeck' | 'trash' | 'banishment'
  | 'championZone' | 'legendZone' | 'base' | 'board' | 'battlefield'
  | 'runeZone' | 'facedown' | 'chain';

interface NormalObject extends ProjectionObjectInput {
  readonly ref: ObjectRef;
  readonly id: string;
  readonly zone: CanonicalZone;
  readonly owner: PlayerId | null;
  readonly controller: PlayerId | null;
  readonly faceDown: boolean;
}

interface NormalPlayer extends ProjectionPlayerInput {
  readonly id: PlayerId;
}

const PUBLIC_ZONES = new Set<CanonicalZone>([
  'trash', 'banishment', 'championZone', 'legendZone', 'base', 'board',
  'battlefield', 'runeZone', 'chain',
]);

const ZONE_KEYS: readonly [CanonicalZone, readonly string[]][] = [
  ['hand', ['hand']],
  ['deck', ['deck', 'mainDeck', 'main-deck']],
  ['runeDeck', ['runeDeck', 'rune-deck']],
  ['trash', ['trash', 'discard']],
  ['banishment', ['banishment', 'banish']],
  ['championZone', ['championZone', 'champion']],
  ['legendZone', ['legendZone', 'legend']],
  ['base', ['base']],
  ['board', ['board']],
  ['battlefield', ['battlefield']],
  ['runeZone', ['runeZone', 'rune-zone', 'rune']],
  ['facedown', ['facedown', 'faceDown']],
];

const isRecord = (value: unknown): value is AnyRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

function playerList(state: ProjectionStateInput): NormalPlayer[] {
  if (Array.isArray(state.players)) {
    return state.players.map((player, index) => normalizePlayer(player, `player-${index}`));
  }
  return Object.entries(state.players).map(([id, player]) => normalizePlayer(player, id));
}

function normalizePlayer(input: ProjectionPlayerInput, fallback: string): NormalPlayer {
  const raw = input as AnyRecord;
  const id = firstString(raw.id, raw.playerId, fallback);
  return { ...input, id };
}

function firstString(...values: readonly unknown[]): string {
  for (const value of values) if (nonEmpty(value)) return value;
  return '';
}

function canonicalZone(input: unknown, fallback: CanonicalZone): CanonicalZone {
  switch (input) {
    case 'hand': return 'hand';
    case 'deck': case 'mainDeck': case 'main-deck': return 'deck';
    case 'rune-deck': case 'runeDeck': return 'runeDeck';
    case 'trash': case 'discard': return 'trash';
    case 'banishment': case 'banish': return 'banishment';
    case 'champion': case 'championZone': return 'championZone';
    case 'legend': case 'legendZone': return 'legendZone';
    case 'base': return 'base';
    case 'board': return 'board';
    case 'battlefield': return 'battlefield';
    case 'rune': case 'rune-zone': case 'runeZone': return 'runeZone';
    case 'facedown': case 'faceDown': return 'facedown';
    case 'chain': return 'chain';
    default: return fallback;
  }
}

function refFrom(value: unknown): ObjectRef | null {
  if (isRecord(value) && isRecord(value.ref) &&
      typeof value.ref.id === 'string' && Number.isSafeInteger(value.ref.zoneEntryId)) {
    return { id: value.ref.id, zoneEntryId: value.ref.zoneEntryId as number };
  }
  if (isRecord(value) && typeof value.id === 'string' && Number.isSafeInteger(value.zoneEntryId)) {
    return { id: value.id, zoneEntryId: value.zoneEntryId as number };
  }
  if (typeof value === 'string') return { id: value, zoneEntryId: 1 };
  return null;
}

/** Return only a reference explicitly carrying zone-entry identity. */
function explicitRefFrom(value: unknown): ObjectRef | null {
  if (isRecord(value) && isRecord(value.ref) &&
      typeof value.ref.id === 'string' && Number.isSafeInteger(value.ref.zoneEntryId)) {
    return { id: value.ref.id, zoneEntryId: value.ref.zoneEntryId as number };
  }
  if (isRecord(value) && typeof value.id === 'string' && Number.isSafeInteger(value.zoneEntryId)) {
    return { id: value.id, zoneEntryId: value.zoneEntryId as number };
  }
  return null;
}

function rawId(value: unknown): string | null {
  if (!isRecord(value)) return typeof value === 'string' ? value : null;
  return firstString(value.id, value.objectId, value.instanceId, value.uid) || null;
}

function normalObject(
  input: ProjectionObjectInput,
  fallbackId: string,
  fallbackZone: CanonicalZone,
  fallbackOwner: PlayerId | null,
): NormalObject {
  const raw = input as AnyRecord;
  const id = firstString(raw.id, raw.objectId, raw.instanceId, raw.uid, fallbackId);
  const zone = canonicalZone(raw.zone, fallbackZone);
  const zoneEntryId = Number.isSafeInteger(raw.zoneEntryId)
    ? raw.zoneEntryId as number
    : isRecord(raw.ref) && Number.isSafeInteger(raw.ref.zoneEntryId)
      ? raw.ref.zoneEntryId as number : 1;
  const owner = firstString(raw.owner, raw.ownerPlayerId) || fallbackOwner;
  const controller = firstString(raw.controller, raw.controllerPlayerId) || owner;
  const faceDown = raw.faceDown === true || raw.hidden === true || zone === 'facedown';
  return {
    ...input,
    ref: { id, zoneEntryId },
    id,
    zone,
    owner,
    controller,
    faceDown,
  };
}

function inputObjects(state: ProjectionStateInput): ProjectionObjectInput[] {
  if (Array.isArray(state.objects)) return [...state.objects];
  if (isRecord(state.objects)) return Object.values(state.objects);
  return [];
}

function allVisibilityWindows(state: ProjectionStateInput): ProjectionVisibilityInput[] {
  const windows: ProjectionVisibilityInput[] = [];
  for (const key of ['visibility', 'visibilityWindows', 'reveals', 'looks', 'showOff'] as const) {
    for (const value of asArray(state[key])) if (isRecord(value)) windows.push(value as ProjectionVisibilityInput);
  }
  return windows;
}

function allChoices(state: ProjectionStateInput): ProjectionChoiceInput[] {
  const choices: ProjectionChoiceInput[] = [];
  for (const key of ['pendingChoices', 'choices', 'outstandingChoices'] as const) {
    for (const value of asArray(state[key])) if (isRecord(value) && nonEmpty(value.id)) choices.push(value as ProjectionChoiceInput);
  }
  return choices;
}

function allChain(state: ProjectionStateInput): ProjectionChainItemInput[] {
  return asArray(state.chain).filter(isRecord) as ProjectionChainItemInput[];
}

function objectKey(ref: ObjectRef): string { return `${ref.id}:${ref.zoneEntryId}`; }

function sameRef(left: ObjectRef | null, right: ObjectRef | null): boolean {
  return left !== null && right !== null && left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function referencedObject(
  value: unknown,
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  fallbackZone: CanonicalZone,
  owner: PlayerId | null,
  ordinal: number,
): NormalObject {
  const explicitRef = explicitRefFrom(value);
  const ref = explicitRef ?? refFrom(value);
  if (ref) {
    const exact = byRef.get(objectKey(ref));
    if (exact) return exact;
    // An explicit ObjectRef whose zoneEntryId is stale must never identify a
    // later incarnation with the same object id. Plain string selectors remain
    // accepted as an input convenience and may use the id index.
    if (!explicitRef) {
      const byIdValue = byId.get(ref.id);
      if (byIdValue) return byIdValue;
    }
  }
  const existingId = rawId(value);
  if (existingId && byId.has(existingId)) return byId.get(existingId)!;
  const object = isRecord(value) ? value as ProjectionObjectInput : { id: existingId ?? `${fallbackZone}-${ordinal}` };
  return normalObject(object, existingId ?? `${fallbackZone}-${ordinal}`, fallbackZone, owner);
}

function collectObjects(state: ProjectionStateInput, players: readonly NormalPlayer[]): NormalObject[] {
  const objects: NormalObject[] = [];
  const byRef = new Map<string, NormalObject>();
  const byId = new Map<string, NormalObject>();
  const add = (value: ProjectionObjectInput, fallbackId: string, zone: CanonicalZone, owner: PlayerId | null): NormalObject => {
    const normalized = normalObject(value, fallbackId, zone, owner);
    const previous = byRef.get(objectKey(normalized.ref));
    if (previous) return previous;
    objects.push(normalized);
    byRef.set(objectKey(normalized.ref), normalized);
    byId.set(normalized.id, normalized);
    return normalized;
  };

  for (const input of inputObjects(state)) add(input, rawId(input) ?? `object-${objects.length}`, canonicalZone(input.zone, 'board'), firstString((input as AnyRecord).owner, (input as AnyRecord).ownerPlayerId) || null);

  for (const player of players) {
    for (const [zone, keys] of ZONE_KEYS) {
      const rawPlayer = player as AnyRecord;
      const value = keys.map(key => rawPlayer[key]).find(candidate => Array.isArray(candidate));
      for (const [index, entry] of asArray(value).entries()) {
        const existing = referencedObject(entry, byRef, byId, zone, player.id, index);
        const exact = byRef.get(objectKey(existing.ref));
        if (!exact) add(existing, existing.id, zone, player.id);
        else if (zone === 'facedown' && !exact.faceDown) {
          const updated = normalObject({ ...exact, faceDown: true }, exact.id, zone, player.id);
          const at = objects.indexOf(exact);
          objects[at] = updated;
          byRef.set(objectKey(updated.ref), updated);
          byId.set(updated.id, updated);
        }
      }
    }
  }

  // The scenario fixtures and the rules layer may keep Battlefield/Base contents
  // under a board aggregate rather than under the owning player. Walk only the
  // board-shaped containers so nested facedown cards receive the same privacy
  // treatment as player-owned zone entries.
  const boardRoot = (state as AnyRecord).battlefields ?? (state as AnyRecord).board;
  const looksLikeObject = (value: AnyRecord): boolean =>
    value.cardId !== undefined || value.name !== undefined || value.zone !== undefined ||
    value.objectId !== undefined || value.instanceId !== undefined || value.uid !== undefined ||
    value.faceDown === true || value.hidden === true;
  const nestedZone = (key: string, fallback: CanonicalZone): CanonicalZone => {
    if (key === 'facedown' || key === 'faceDown') return 'facedown';
    if (key === 'base' || key === 'bases') return 'base';
    if (key === 'rune' || key === 'runes' || key === 'runeZone') return 'runeZone';
    if (key === 'chain') return 'chain';
    return fallback;
  };
  const visitBoard = (value: unknown, zone: CanonicalZone, owner: PlayerId | null, controller: PlayerId | null): void => {
    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        if (isRecord(entry) && looksLikeObject(entry)) {
          add({ ...entry, controller: typeof entry.controller === 'string' ? entry.controller : controller }, rawId(entry) ?? `board-${objects.length}-${index}`, zone, owner);
        } else visitBoard(entry, zone, owner, controller);
      }
      return;
    }
    if (!isRecord(value)) return;
    if (looksLikeObject(value)) {
      add({ ...value, controller: typeof value.controller === 'string' ? value.controller : controller }, rawId(value) ?? `board-${objects.length}`, zone, owner);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' || key === 'locationId' || key === 'controller' || key === 'owner') continue;
      const seat: PlayerId | null = players.some(player => player.id === key) ? key : owner;
      visitBoard(child, nestedZone(key, zone), seat, controller ?? seat);
    }
  };
  if (boardRoot !== undefined) visitBoard(boardRoot, 'battlefield', null, null);

  for (const item of allChain(state)) {
    for (const candidate of [item.source, item.object]) {
      if (candidate === undefined) continue;
      const source = referencedObject(candidate, byRef, byId, 'chain', null, objects.length);
      const chainObject = normalObject({ ...source, zone: 'chain', faceDown: false }, source.id, 'chain', source.owner);
      if (!byRef.has(objectKey(chainObject.ref))) add(chainObject, chainObject.id, 'chain', chainObject.owner);
    }
  }
  return objects;
}

function viewerKey(viewer: ProjectionViewer): string {
  return viewer === null ? 'spectator' : viewer;
}

function opaqueId(viewer: ProjectionViewer, object: NormalObject, ordinal: number): string {
  // Do not derive this from the physical id. The viewer-scoped token is intentionally
  // unrelated to the authoritative id and changes when zoneEntryId/zone changes.
  const seed = `${viewerKey(viewer)}|${object.zone}|${object.ref.zoneEntryId}|${ordinal}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `hidden:${Math.abs(hash >>> 0).toString(36)}`;
}

function grantObjectRefs(grant: ProjectionVisibilityInput): readonly (ObjectRef | string)[] {
  const refs: (ObjectRef | string)[] = [];
  for (const value of asArray(grant.objectIds)) {
    if (typeof value === 'string') refs.push(value);
    else {
      const ref = explicitRefFrom(value);
      if (ref) refs.push(ref);
    }
  }
  for (const value of asArray(grant.objects)) {
    if (typeof value === 'string') refs.push(value);
    else {
      const ref = explicitRefFrom(value);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

function grantMatches(grant: ProjectionVisibilityInput, object: NormalObject): boolean {
  const refs = grantObjectRefs(grant);
  if (refs.length === 0) return false;
  return refs.some(ref => typeof ref === 'string'
    ? ref === object.id
    : sameRef(ref, object.ref));
}

function grantIsActive(grant: ProjectionVisibilityInput): boolean {
  return grant.active !== false;
}

function gameHasEnded(state: ProjectionStateInput): boolean {
  const raw = state as AnyRecord;
  if (raw.ended === true || raw.gameEnded === true) return true;
  const status = firstString(raw.status, raw.phase).toLowerCase();
  return status === 'ended' || status === 'game-ended' || status === 'finished' || status === 'complete';
}

function grantAllows(grant: ProjectionVisibilityInput, viewer: ProjectionViewer): boolean {
  if (!grantIsActive(grant)) return false;
  const viewers = grant.viewers;
  if (viewers === 'all') return true;
  if (Array.isArray(viewers)) return viewer !== null && viewers.includes(viewer);
  if (grant.player) return viewer === grant.player;
  // `look` is private by definition; a missing player is an invalid grant and is
  // ignored rather than accidentally becoming public.
  return grant.kind !== 'look' && viewer !== null;
}

function matchingGrants(
  windows: readonly ProjectionVisibilityInput[],
  object: NormalObject,
  viewer: ProjectionViewer,
): ProjectionVisibilityInput[] {
  return windows.filter(grant => grantMatches(grant, object) && grantAllows(grant, viewer));
}

function visibilityFor(
  object: NormalObject,
  viewer: ProjectionViewer,
  windows: readonly ProjectionVisibilityInput[],
): { readonly identity: boolean; readonly showProperties?: readonly string[] } {
  const grants = matchingGrants(windows, object, viewer);
  const reveal = grants.find(grant => grant.kind === 'reveal');
  if (reveal) return { identity: true };
  const show = grants.find(grant => grant.kind === 'show-off');
  if (show) return { identity: true, showProperties: show.properties };
  if (grants.some(grant => grant.kind === 'look')) return { identity: true };
  if (object.faceDown) return { identity: viewer !== null && viewer === object.controller };
  if (object.zone === 'deck' || object.zone === 'runeDeck') return { identity: false };
  if (object.zone === 'hand') return { identity: viewer !== null && viewer === object.owner };
  return { identity: PUBLIC_ZONES.has(object.zone) };
}

const ALL_CHARACTERISTICS = [
  'cardId', 'name', 'types', 'tags', 'keywords', 'might', 'energy', 'power',
  'cost', 'speed', 'reaction', 'hiddenOnTurn', 'exhausted', 'damage', 'stunned',
  'buffs', 'counters', 'attachedTo', 'isToken',
] as const;

function projectObject(
  object: NormalObject,
  viewer: ProjectionViewer,
  windows: readonly ProjectionVisibilityInput[],
  ordinal: number,
  forcePublic = false,
  forcePublicFaceDown = false,
): ProjectedObject {
  const granted = forcePublic || (forcePublicFaceDown && object.faceDown)
    ? { identity: true }
    : visibilityFor(object, viewer, windows);
  const identity = granted.identity;
  const id = identity ? object.id : opaqueId(viewer, object, ordinal);
  const base: ProjectedObject = {
    id,
    ref: { id, zoneEntryId: object.ref.zoneEntryId },
    zone: object.zone,
    zoneEntryId: object.ref.zoneEntryId,
    owner: object.owner,
    controller: object.controller,
    faceDown: object.faceDown || !identity,
    visibility: identity ? 'identity' : 'face-down',
    location: object.location ?? null,
  };
  if (!identity) return base;

  const showProperties = granted.showProperties;
  // Show Off exposes the selected characteristics, while the identity of the
  // shown card is necessarily part of the public announcement itself.
  const selected = (key: string): boolean =>
    showProperties === undefined || showProperties.includes(key) ||
    (showProperties !== undefined && (key === 'cardId' || key === 'name'));
  const output: ProjectedObject = {
    ...base,
    ...(selected('cardId') && object.cardId !== null && object.cardId !== undefined ? { cardId: object.cardId } : {}),
    ...(selected('name') && object.name !== undefined ? { name: object.name } : {}),
    ...(selected('cost') && object.cost !== undefined ? { cost: object.cost } : {}),
    ...(selected('speed') && object.speed !== undefined ? { speed: object.speed } : {}),
    ...(selected('reaction') && object.reaction !== undefined ? { reaction: object.reaction } : {}),
    ...(selected('hiddenOnTurn') && object.hiddenOnTurn !== undefined ? { hiddenOnTurn: object.hiddenOnTurn } : {}),
    ...(selected('types') && object.types !== undefined ? { types: [...object.types] } : {}),
    ...(selected('tags') && object.tags !== undefined ? { tags: [...object.tags] } : {}),
    ...(selected('keywords') && object.keywords !== undefined ? { keywords: [...object.keywords] } : {}),
    ...(selected('might') && object.might !== undefined ? { might: object.might } : {}),
    ...(selected('energy') && object.energy !== undefined ? { energy: object.energy } : {}),
    ...(selected('power') && object.power !== undefined ? { power: object.power ? [...object.power] : null } : {}),
    ...(selected('exhausted') && object.exhausted !== undefined ? { exhausted: object.exhausted } : {}),
    ...(selected('damage') && object.damage !== undefined ? { damage: object.damage } : {}),
    ...(selected('stunned') && object.stunned !== undefined ? { stunned: object.stunned } : {}),
    ...(selected('buffs') && object.buffs !== undefined ? { buffs: object.buffs } : {}),
    ...(selected('counters') && object.counters !== undefined ? { counters: { ...object.counters } } : {}),
    ...(selected('attachedTo') && object.attachedTo !== undefined ? { attachedTo: object.attachedTo } : {}),
    ...(selected('isToken') && object.isToken !== undefined ? { isToken: object.isToken } : {}),
    ...(showProperties !== undefined ? { shownProperties: [...showProperties] } : {}),
  };
  return output;
}

function zoneEntries(player: NormalPlayer, zone: CanonicalZone): readonly unknown[] {
  const raw = player as AnyRecord;
  const keys = ZONE_KEYS.find(([candidate]) => candidate === zone)?.[1] ?? [];
  const value = keys.map(key => raw[key]).find(candidate => Array.isArray(candidate));
  return asArray(value);
}

function stableOrdinal(objects: readonly NormalObject[], object: NormalObject, fallback: number): number {
  const ordinal = objects.indexOf(object);
  return ordinal >= 0 ? ordinal : fallback;
}

function zoneProjection(
  player: NormalPlayer,
  zone: CanonicalZone,
  objects: readonly NormalObject[],
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  viewer: ProjectionViewer,
  windows: readonly ProjectionVisibilityInput[],
  forcePublicFaceDown: boolean,
): ProjectedZone {
  const entries = zoneEntries(player, zone);
  const selected: NormalObject[] = [];
  for (const [index, entry] of entries.entries()) {
    const object = referencedObject(entry, byRef, byId, zone, player.id, index);
    const existing = objects.find(candidate => sameRef(candidate.ref, object.ref) || candidate.id === object.id) ?? object;
    selected.push(existing);
  }
  // Decks and rune decks intentionally do not expose placeholder cards. A look/reveal
  // grant can expose a selected card through the cards list while count/order remain explicit.
  const cards = zone === 'deck' || zone === 'runeDeck'
    ? selected.flatMap((object, index) => {
      const projected = projectObject(object, viewer, windows, stableOrdinal(objects, object, index), false, forcePublicFaceDown);
      return projected.visibility === 'identity' ? [projected] : [];
    })
    : selected.map((object, index) => projectObject(object, viewer, windows, stableOrdinal(objects, object, index), false, forcePublicFaceDown));
  const identitiesVisible = cards.some(card => card.visibility === 'identity');
  const allIdentity = selected.length > 0 && cards.length === selected.length && identitiesVisible;
  return {
    count: selected.length,
    cards,
    identitiesVisible: allIdentity,
    orderKnown: (zone !== 'deck' && zone !== 'runeDeck') || allIdentity,
  };
}

function projectPlayer(
  player: NormalPlayer,
  objects: readonly NormalObject[],
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  viewer: ProjectionViewer,
  windows: readonly ProjectionVisibilityInput[],
  forcePublicFaceDown: boolean,
): ProjectedPlayer {
  const output: ProjectedPlayer = {
    id: player.id,
    ...(player.name !== undefined ? { name: player.name } : {}),
    ...(player.energy !== undefined ? { energy: player.energy } : {}),
    ...(player.power !== undefined ? { power: [...player.power] } : {}),
    ...(player.score !== undefined ? { score: player.score } : {}),
    ...(player.points !== undefined ? { points: player.points } : {}),
    ...(player.xp !== undefined ? { xp: player.xp } : {}),
    handCount: 0,
    mainDeckCount: 0,
    deckCount: 0,
    runeDeckCount: 0,
    hand: zoneProjection(player, 'hand', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    mainDeck: zoneProjection(player, 'deck', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    deck: zoneProjection(player, 'deck', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    runeDeck: zoneProjection(player, 'runeDeck', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    trash: zoneProjection(player, 'trash', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    banishment: zoneProjection(player, 'banishment', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    championZone: zoneProjection(player, 'championZone', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    legendZone: zoneProjection(player, 'legendZone', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    base: zoneProjection(player, 'base', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    board: zoneProjection(player, 'board', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    battlefield: zoneProjection(player, 'battlefield', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    runeZone: zoneProjection(player, 'runeZone', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
    facedown: zoneProjection(player, 'facedown', objects, byRef, byId, viewer, windows, forcePublicFaceDown),
  };
  return {
    ...output,
    handCount: output.hand.count,
    mainDeckCount: output.mainDeck.count,
    deckCount: output.deck.count,
    runeDeckCount: output.runeDeck.count,
  };
}

function projectChain(
  item: ProjectionChainItemInput,
  index: number,
  objects: readonly NormalObject[],
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  viewer: ProjectionViewer,
  windows: readonly ProjectionVisibilityInput[],
  forcePublicFaceDown: boolean,
): ProjectedChainItem {
  const source = item.source === undefined ? null : referencedObject(item.source, byRef, byId, 'chain', null, index);
  const object = item.object === undefined ? source : referencedObject(item.object, byRef, byId, 'chain', null, index);
  const project = (candidate: NormalObject | null): ProjectedObject | null =>
    candidate ? projectObject({ ...candidate, zone: 'chain', faceDown: false }, viewer, windows, stableOrdinal(objects, candidate, index), true) : null;
  const targets = asArray(item.targets).flatMap((target, targetIndex) => {
    const candidate = referencedObject(target, byRef, byId, 'chain', null, targetIndex);
    return candidate ? [projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, targetIndex), !candidate.faceDown, forcePublicFaceDown)] : [];
  });
  return {
    id: firstString(item.id, item.itemId, `chain-${index}`),
    status: firstString(item.status, 'pending'),
    controller: firstString(item.controller, item.controllerPlayerId, item.player) || null,
    source: project(source),
    object: project(object),
    targets,
  };
}

function projectChoice(
  choice: ProjectionChoiceInput,
  viewer: ProjectionViewer,
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  objects: readonly NormalObject[],
  windows: readonly ProjectionVisibilityInput[],
): ProjectedChoiceRequest | null {
  const chooser = firstString(choice.chooser, choice.player, choice.playerId);
  // Choice requests are addressed to exactly one player. Even a public answer may
  // be recorded in the journal, but the request itself is never sent to spectators
  // or the opponent.
  if (!chooser || viewer !== chooser) return null;
  const options = asArray(choice.options).map((option, index) => {
    if (typeof option === 'string') {
      const candidate = objects.find(object => object.id === option);
      return candidate
        ? projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, index))
        : option;
    }
    const ref = refFrom(option);
    if (!ref) return typeof option === 'string' ? option : JSON.stringify(option);
    const candidate = referencedObject(option, byRef, byId, 'hand', chooser, index);
    return projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, index));
  });
  return {
    id: choice.id,
    chooser,
    visibility: 'chooser-only',
    ...(choice.prompt !== undefined ? { prompt: choice.prompt } : {}),
    ...(choice.type !== undefined ? { type: choice.type } : {}),
    ...(choice.options !== undefined ? { options } : {}),
    ...(choice.min !== undefined ? { min: choice.min } : {}),
    ...(choice.max !== undefined ? { max: choice.max } : {}),
  };
}

const PRIVATE_EVENT_KEYS = new Set([
  'cardId', 'physicalCardId', 'printingId', 'card', 'name', 'objectId',
  'instanceId', 'uid', 'ref',
]);

function sanitizeNestedEventValue(
  value: unknown,
  key: string,
  publicEvent: boolean,
  viewer: ProjectionViewer,
  objects: readonly NormalObject[],
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  windows: readonly ProjectionVisibilityInput[],
  index: number,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, entryIndex) => sanitizeNestedEventValue(
      entry, key, publicEvent, viewer, objects, byRef, byId, windows, entryIndex));
  }
  if (!isRecord(value)) return value;

  const objectLike = key === 'object' || key === 'source' || key === 'target' || key === 'objects' ||
    value.cardId !== undefined || value.zone !== undefined || value.zoneEntryId !== undefined ||
    value.ref !== undefined || value.objectId !== undefined || value.instanceId !== undefined || value.uid !== undefined;
  if (objectLike && (key === 'object' || key === 'source' || key === 'target' || value.cardId !== undefined || value.zone !== undefined || value.ref !== undefined)) {
    const candidate = referencedObject(value, byRef, byId, 'board', null, index);
    return projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, index), publicEvent);
  }

  const output: AnyRecord = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (!publicEvent && PRIVATE_EVENT_KEYS.has(childKey)) continue;
    output[childKey] = sanitizeNestedEventValue(
      childValue, childKey, publicEvent, viewer, objects, byRef, byId, windows, index);
  }
  return output;
}

function safeEvent(
  event: unknown,
  viewer: ProjectionViewer,
  objects: readonly NormalObject[],
  byRef: Map<string, NormalObject>,
  byId: Map<string, NormalObject>,
  windows: readonly ProjectionVisibilityInput[],
  index: number,
): ProjectedEvent {
  if (!isRecord(event)) return {};
  const output: AnyRecord = {};
  const audience = event.audience;
  const eventType = firstString(event.type, event.timing, event.timingPoint);
  const eventViewers = Array.isArray(event.viewers) ? event.viewers.filter(nonEmpty) : [];
  const eventIsPublicReveal = audience === 'all' || eventType === 'card.revealed' || eventType === 'card-reveal';
  const eventIsShownToViewer = eventType === 'card.shown' &&
    viewer !== null && (audience === viewer || eventViewers.includes(viewer));
  const publicEvent = eventIsPublicReveal || eventIsShownToViewer;
  for (const [key, value] of Object.entries(event)) {
    if (key === 'object' || key === 'source' || key === 'target') {
      const candidate = referencedObject(value, byRef, byId, 'board', null, index);
      output[key] = projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, index), publicEvent);
    } else if (key === 'objects' && Array.isArray(value)) {
      output[key] = value.map((entry, entryIndex) => {
        const candidate = referencedObject(entry, byRef, byId, 'board', null, entryIndex);
        return projectObject(candidate, viewer, windows, stableOrdinal(objects, candidate, entryIndex), publicEvent);
      });
    } else if (key === 'cardId' || key === 'physicalCardId' || key === 'card' || key === 'name' ||
      key === 'objectId' || key === 'instanceId' || key === 'uid' || key === 'ref') {
      // Event-level card characteristics are copied only when the event is explicitly
      // public. Hidden events are represented by their sanitized object above. Raw
      // object ids are treated the same way so a stale/debug payload cannot bypass
      // the projection boundary.
      if (publicEvent) output[key] = value;
    } else if (key === 'options' && Array.isArray(value)) {
      // A prompt event may be journaled for audit, but its private options are
      // never sent through a non-chooser projection.
      const chooser = firstString(event.chooser, event.player, event.playerId);
      if (chooser && viewer === chooser) output[key] = sanitizeNestedEventValue(
        value, key, true, viewer, objects, byRef, byId, windows, index);
    } else {
      output[key] = sanitizeNestedEventValue(
        value, key, publicEvent, viewer, objects, byRef, byId, windows, index);
    }
  }
  return output;
}

function projectVisibilityWindow(
  grant: ProjectionVisibilityInput,
  viewer: ProjectionViewer,
  objects: readonly NormalObject[],
  windows: readonly ProjectionVisibilityInput[],
): ProjectionVisibilityInput {
  const visibleObjects = objects.flatMap((object, index) => {
    if (!grantMatches(grant, object)) return [];
    const projected = projectObject(object, viewer, windows, stableOrdinal(objects, object, index));
    return [projected.ref];
  });
  return {
    kind: grant.kind,
    objectIds: visibleObjects,
    ...(grant.player !== undefined ? { player: grant.player } : {}),
    ...(grant.viewers !== undefined ? { viewers: grant.viewers } : {}),
    ...(grant.properties !== undefined ? { properties: [...grant.properties] } : {}),
    ...(grant.active !== undefined ? { active: grant.active } : {}),
    ...(grant.duration !== undefined ? { duration: grant.duration } : {}),
    ...(grant.until !== undefined ? { until: grant.until } : {}),
    ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
  };
}

function inputEvents(state: ProjectionStateInput): readonly unknown[] {
  const raw = state as AnyRecord;
  return asArray(raw.events ?? raw.eventLog);
}

function validateViewer(viewer: ProjectionViewer, players: readonly NormalPlayer[]): void {
  if (viewer === null || viewer === 'spectator' || viewer === 'replay') return;
  if (!players.some(player => player.id === viewer)) throw new Error(`Unknown projection viewer: ${viewer}`);
}

/**
 * Create a privacy-filtered view of the authoritative state for one seat.
 *
 * The function is pure: it never mutates state, card objects, chain entries or
 * pending choices. Spectator and replay callers use the same restricted policy.
 */
export function projectFor(state: ProjectionStateInput, viewer: ProjectionViewer): ProjectionV2 {
  const players = playerList(state);
  validateViewer(viewer, players);
  const windows = allVisibilityWindows(state);
  const forcePublicFaceDown = gameHasEnded(state);
  const objects = collectObjects(state, players);
  const byRef = new Map(objects.map(object => [objectKey(object.ref), object]));
  const byId = new Map(objects.map(object => [object.id, object]));
  const projectedPlayers = Object.fromEntries(players.map(player => [
    player.id,
    projectPlayer(player, objects, byRef, byId, viewer, windows, forcePublicFaceDown),
  ])) as Readonly<Record<PlayerId, ProjectedPlayer>>;

  const projectedObjectList = objects.map((object, index) => projectObject(object, viewer, windows, index, false, forcePublicFaceDown));
  const chain = allChain(state).map((item, index) => projectChain(item, index, objects, byRef, byId, viewer, windows, forcePublicFaceDown));
  const choices = allChoices(state).flatMap(choice => {
    const projected = projectChoice(choice, viewer, byRef, byId, objects, windows);
    return projected ? [projected] : [];
  });
  const raw = state as AnyRecord;
  const events = inputEvents(state).map((event, index) => safeEvent(event, viewer, objects, byRef, byId, windows, index));

  return {
    schemaVersion: 2,
    viewer,
    ...(typeof state.stateVersion === 'number'
      ? { stateVersion: state.stateVersion }
      : typeof state.version === 'number' ? { stateVersion: state.version } : {}),
    ...(typeof state.eventSeq === 'number' ? { eventSeq: state.eventSeq } : {}),
    ...(typeof state.phase === 'string' ? { phase: state.phase } : {}),
    ...(state.turn !== undefined ? { turn: state.turn } : {}),
    ...(Object.hasOwn(raw, 'priorityPlayerId') ? { priorityPlayerId: state.priorityPlayerId ?? null } : {}),
    ...(Object.hasOwn(raw, 'focusPlayerId') ? { focusPlayerId: state.focusPlayerId ?? null } : {}),
    players: projectedPlayers,
    objects: projectedObjectList,
    chain,
    choices,
    choice: choices[0] ?? null,
    visibility: windows
      .filter(grant => grantIsActive(grant) && grantAllows(grant, viewer))
      .map(grant => projectVisibilityWindow(grant, viewer, objects, windows)),
    events,
  };
}
