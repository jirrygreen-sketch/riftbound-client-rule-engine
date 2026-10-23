import type {
  V2ChooseCommand,
  V2Command,
  V2PendingChoice,
  V2Projection
} from "../../../protocol/src/v2/index.js";

function pendingChoice(projection: V2Projection): Extract<V2PendingChoice, { status: "pending" }> | null {
  return projection.pendingChoice.status === "pending" ? projection.pendingChoice : null;
}

function choiceAnswer(choice: Extract<V2PendingChoice, { status: "pending" }>) {
  const options = choice.options ?? [];
  const minimum = Math.max(1, choice.min ?? 1);
  const maximum = Math.min(options.length, choice.max ?? options.length);
  switch (choice.kind) {
    case "optional":
      return options.find(option => option.value === false)?.value ?? false;
    case "mode":
      return options[0]?.value ?? options[0]?.id ?? null;
    case "select-objects":
      return options.slice(0, Math.max(minimum, Math.min(maximum, options.length)))
        .map(option => option.objectRef ?? option.id);
    case "order":
      return options.map(option => option.objectRef ?? option.id);
    case "number":
      return choice.min ?? 0;
  }
}

export function chooseCommand(projection: V2Projection, viewerPlayerId: string, commandId: string): V2ChooseCommand | null {
  const choice = pendingChoice(projection);
  if (!choice || choice.ownerPlayerId !== viewerPlayerId) return null;
  const answer = choiceAnswer(choice);
  if (answer === null || (Array.isArray(answer) && answer.length === 0 && (choice.min ?? 1) > 0)) return null;
  return {
    type: "choose",
    commandId,
    stateVersion: projection.stateVersion,
    choiceId: choice.choiceId,
    answer: answer as V2ChooseCommand["answer"]
  };
}

export function readyRunes(projection: V2Projection, viewerPlayerId: string) {
  return (projection.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === viewerPlayerId)?.objects ?? [])
    .filter((rune): rune is typeof rune & { readonly zoneEntryId: number } =>
      rune.exhausted === false && rune.cardId !== undefined && rune.zoneEntryId !== undefined);
}

export function botCommand(
  projection: V2Projection,
  viewerPlayerId: string,
  commandId: string,
  rejectedPlayIds: ReadonlySet<string> = new Set(),
  cardFacts: ReadonlyMap<string, {
    readonly energy: number | null;
    readonly power: number | null;
    readonly hasComplexAbility: boolean;
    readonly kind: "unit" | "gear" | "spell";
  }> = new Map()
): V2Command | null {
  const choice = chooseCommand(projection, viewerPlayerId, commandId);
  if (choice) return choice;
  if (projection.winnerPlayerId !== null) return null;
  // A pending request may be answered only by its owner with projected
  // candidates. Passing would resolve the surrounding Finalize without an
  // answer, so report that the current client cannot act instead.
  if (projection.pendingChoice.status === "pending") return null;
  const hand = projection.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === viewerPlayerId)?.objects ?? [];
  const payable = (option: V2Projection["actionOptions"]["plays"][number]) => {
    const card = hand.find(candidate => candidate.objectId === option.cardObjectId);
    if (!card) return false;
    const fact = card.cardId === undefined ? undefined : cardFacts.get(card.cardId);
    return fact === undefined || fact.power === null || fact.power === 0;
  };
  // Some dynamic card abilities currently suspend without a receipt in the
  // server runtime. Choose plain permanents first while the server remains
  // authoritative over every legal play and destination.
  const choiceSafe = (option: V2Projection["actionOptions"]["plays"][number]) =>
    !cardFacts.get(hand.find(candidate => candidate.objectId === option.cardObjectId)?.cardId ?? "")
      ?.hasComplexAbility;
  const blockedProjectedPlay = new Set([
    "Plundering Poro", "Dangerous Duo", "Gem Jammer", "Frigid Touch"
  ]);
  const projectedPlayName = (option: V2Projection["actionOptions"]["plays"][number]) =>
    hand.find(card => card.objectId === option.cardObjectId)?.name ?? "";
  const playable = projection.actionOptions.plays.find(option =>
    !rejectedPlayIds.has(option.cardObjectId) && payable(option) &&
    choiceSafe(option) &&
    !blockedProjectedPlay.has(projectedPlayName(option)));
  const playableToBase = projection.actionOptions.plays.find(option =>
    option.destination.kind === "base" && !rejectedPlayIds.has(option.cardObjectId) && payable(option) &&
    choiceSafe(option) &&
    !blockedProjectedPlay.has(projectedPlayName(option)));
  const unitPlay = projection.actionOptions.plays.find(option => {
    const card = hand.find(candidate => candidate.objectId === option.cardObjectId);
    return !rejectedPlayIds.has(option.cardObjectId) && payable(option) &&
      card?.cardId !== undefined && cardFacts.get(card.cardId)?.kind === "unit" &&
      choiceSafe(option) && !blockedProjectedPlay.has(projectedPlayName(option));
  });
  const readyRune = readyRunes(projection, viewerPlayerId)[0];
  const energy = projection.players.find(player => player.playerId === viewerPlayerId)?.energy ?? 0;
  // There are no non-permanent Action/Reaction cards in the V2 action surface.
  // Use a whole Main Phase to Channel Runes or play an affordable permanent;
  // ending first would otherwise close every turn with zero resources.
  if (projection.phase === "main" && projection.combat.status === "none" &&
      projection.chain.items.length === 0 && projection.actionOptions.canEndTurn &&
      !playable && projection.actionOptions.moves.length === 0 && !readyRune) {
    return { type: "end-turn", commandId, stateVersion: projection.stateVersion };
  }
  if (projection.combat.status === "active") {
    if (projection.combat.step === "damage" && projection.combat.damage?.expectedPlayerId === viewerPlayerId) {
      const battlefield = projection.battlefields.find(field => field.battlefieldId === projection.combat.battlefieldId);
      const opponent = projection.players.find(player => player.playerId !== viewerPlayerId)?.playerId ?? null;
      const units = (battlefield?.occupantObjectIds ?? []).flatMap(id => {
        const unit = projection.objects.find(object => object.objectId === id);
        return unit ? [unit] : [];
      });
      const attackerIds = units.filter(unit => unit.controllerPlayerId === viewerPlayerId).map(unit => unit.objectId);
      const defenderIds = units.filter(unit => unit.controllerPlayerId === opponent).map(unit => unit.objectId);
      const targets = projection.combat.damage.attackerSubmitted ? defenderIds : attackerIds;
      if (targets.length === 0) return null;
      const total = projection.combat.damage.attackerSubmitted
        ? projection.combat.damage.defenderMight
        : projection.combat.damage.attackerMight;
      const assignments = targets.map((unitObjectId, index) => ({
        unitObjectId,
        amount: index === targets.length - 1 ? total - Math.floor(total / targets.length) * (targets.length - 1) : Math.floor(total / targets.length)
      })).filter(assignment => assignment.amount > 0);
      return assignments.length > 0 && projection.combat.combatId
        ? { type: "combat-damage", commandId, stateVersion: projection.stateVersion,
          combatId: projection.combat.combatId, assignments }
        : null;
    }
    return projection.priority.playerId === viewerPlayerId ?
      { type: "pass", commandId, stateVersion: projection.stateVersion } : null;
  }
  if (projection.actionOptions.canAdvance === true && projection.activePlayerId === viewerPlayerId) {
    return { type: "advance", commandId, stateVersion: projection.stateVersion };
  }
  // During a closed priority window the only projected legal continuation is
  // a pass, not a new Main Phase play. Keep the chains from piling on work
  // without resolving the already-announced items first.
  if (projection.chain.items.length > 0 && projection.chain.status === "closed") {
    return projection.priority.playerId === viewerPlayerId
      ? { type: "pass", commandId, stateVersion: projection.stateVersion }
      : null;
  }
  const fieldMoves = projection.actionOptions.moves.flatMap(candidate =>
    candidate.destination.kind === "battlefield" ? [{ candidate, field: projection.battlefields.find(value =>
      value.battlefieldId === (candidate.destination.kind === "battlefield" ? candidate.destination.battlefieldId : "")) }] : []);
  const move = (fieldMoves.find(({ field }) => field?.controllerPlayerId === null ||
    field?.controllerPlayerId === viewerPlayerId) ?? fieldMoves[0])?.candidate;
  if (move) {
    return { type: "move", commandId, stateVersion: projection.stateVersion, objectId: move.objectId,
      to: move.destination.kind === "base"
        ? { zone: "base", playerId: move.destination.playerId }
        : { zone: "battlefield", locationId: move.destination.battlefieldId } };
  }
  if (unitPlay ?? playableToBase ?? playable) {
    const play = unitPlay ?? playableToBase ?? playable!;
    return { type: "play", commandId, stateVersion: projection.stateVersion,
      cardObjectId: play.cardObjectId, destination: play.destination };
  }
  // Preserve enough Energy to attempt the cheapest projected permanent on the
  // next turn. The projection only lists cards whose printed cost is payable.
  if (readyRune && energy === 0) {
    return { type: "rune-energy", commandId, stateVersion: projection.stateVersion,
      runeObjectId: readyRune.objectId, zoneEntryId: readyRune.zoneEntryId };
  }
  if (readyRune) {
    if (energy < 3) {
      return { type: "rune-energy", commandId, stateVersion: projection.stateVersion,
        runeObjectId: readyRune.objectId, zoneEntryId: readyRune.zoneEntryId };
    }
  }
  if (projection.chain.items.length > 0 || projection.priority.focusPlayerId !== null) {
    return projection.priority.playerId === viewerPlayerId
      ? { type: "pass", commandId, stateVersion: projection.stateVersion }
      : null;
  }
  if (projection.actionOptions.canEndTurn && projection.activePlayerId === viewerPlayerId) {
    return { type: "end-turn", commandId, stateVersion: projection.stateVersion };
  }
  return null;
}

/** Project-local memory of rejected hand incarnations. It is not authority:
 * only the current server projection decides whether a play remains legal. */
export function projectedPlayCandidates(projection: V2Projection, viewerPlayerId: string,
  rejected: ReadonlySet<string>) {
  const hand = projection.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === viewerPlayerId)?.objects ?? [];
  return projection.actionOptions.plays.filter(option => !rejected.has(option.cardObjectId) &&
    hand.some(card => card.objectId === option.cardObjectId));
}

export function projectedPlayableCards(projection: V2Projection, viewerPlayerId: string): readonly string[] {
  const hand = projection.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === viewerPlayerId)?.objects ?? [];
  return projection.actionOptions.plays.flatMap(option => {
    const card = hand.find(object => object.objectId === option.cardObjectId);
    return card?.cardId ? [card.cardId] : [];
  });
}
