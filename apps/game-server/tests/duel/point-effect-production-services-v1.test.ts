import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DuelCanonicalPlayingStateV2 } from "@riftbound/engine-core/duel";
import {
  beginDuelPointDamageEffectV1,
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  createDuelPointDamageEffectAuthorityV1,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  referenceDuelPhysicalCardV2,
  moveDuelPhysicalCardToChainV2,
  placeDuelUnit,
  resolveDuelMulliganV2,
  submitDuelPointDamageEffectChoiceV1,
} from "@riftbound/engine-core/duel";
import type { PublicCardCatalog, CardCatalogRuntime } from "../../src/card-catalog.js";
import { createDuelPointDamageCardProgramAuthorityV1, getCardProgramRegistryForRuntime } from "../../src/duel/card-program-authority.js";
import { createDuelPointEffectProductionServicesV1 } from "../../src/duel/point-effect-production-services-v1.js";

const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as PublicCardCatalog;
const runtime = { publicCatalog: catalog } as unknown as CardCatalogRuntime;

function sources(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    inspect: () => ({ status: "pending" as const, candidates: [], sources: [], eventSources: [], activeSources: [], handlers: [], runtimeSources: [], ...overrides }),
    derivedMight: () => ({ status: "blocked" as const, uid: "unit", reason: "fixture" }),
  } as any;
}

function synthetic(id: string, cardType: string, might: number | null = null) {
  return { id, canonicalCardId: id, name: id, fullName: id, localizedName: id,
    cardType, domains: ["Fury"], tags: [], setCode: "fixture", cardNumber: id,
    variant: "standard", imageUrl: null, energy: cardType === "Unit" ? 1 : null,
    power: null, might, ability: "" } as any;
}

function coreFixture(targetMight: number) {
  const point = catalog.cards.find(card => card.id === "ogs-003-024")!;
  const cards = [point, synthetic("fixture-unit", "Unit", targetMight),
    synthetic("fixture-champion", "Champion"), synthetic("fixture-legend", "Legend"),
    synthetic("fixture-rune", "Rune"), ...["a", "b"].flatMap(player =>
      Array.from({ length: 3 }, (_, index) => synthetic(`${player}-field-${index}`, "Battlefield")))];
  const loaded = { publicCatalog: { ...catalog, cards } } as unknown as CardCatalogRuntime;
  const authority = createDuelPointDamageCardProgramAuthorityV1(loaded);
  const seats = ["a", "b"].map(playerId => ({
    playerId,
    mainDeck: Array.from({ length: 10 }, (_, index) => ({ uid: `${playerId}-main-${index}`,
      cardId: playerId === "a" && index === 1 ? point.id : "fixture-unit" })),
    champion: { uid: `${playerId}-champion`, cardId: "fixture-champion" },
    legend: { uid: `${playerId}-legend`, cardId: "fixture-legend" },
    runeDeck: Array.from({ length: 6 }, (_, index) => ({ uid: `${playerId}-rune-${index}`,
      cardId: "fixture-rune", domain: "Fury" as const })),
    battlefields: ["0", "1", "2"].map(index => ({ instanceId: `${playerId}-field-${index}`,
      cardId: `${playerId}-field-${index}` })),
  }));
  const typeOf = (cardId: string) => cards.find(card => card.id === cardId)?.cardType === "Spell" ? "Other" : cards.find(card => card.id === cardId)?.cardType;
  const metadata = { matchId: `point-provider-${targetMight}`, dataVersion: catalog.dataVersion,
    catalogDigest: catalog.digest, roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  let state = createDuelMatchV2(seats as any, metadata, () => 0, typeOf as any) as DuelCanonicalPlayingStateV2;
  state = resolveDuelMulliganV2(state, "a", []) as DuelCanonicalPlayingStateV2;
  state = resolveDuelMulliganV2(state, "b", []) as DuelCanonicalPlayingStateV2;
  const targetCard = state.players[1].hand.find(card => card.cardId === "fixture-unit")!;
  const targetField = state.board.battlefields.find(field => field.ownerPlayerId === "b")!;
  state = commitDuelPlayingMutationV2(state, draft => {
    const board = placeDuelUnit(draft.board, { objectId: targetCard.uid,
      controllerPlayerId: "b", locationId: targetField.locationId });
    return { match: { ...draft, board, players: [draft.players[0], { ...draft.players[1],
      hand: draft.players[1].hand.filter(card => card.uid !== targetCard.uid) }],
      unitMeta: { ...draft.unitMeta, [targetCard.uid]: { ownerPlayerId: "b", readied: false,
        damageMarks: [], trait: { kind: "card", cardId: "fixture-unit" } } } },
      transitions: [{ uid: targetCard.uid, from: { kind: "hand", zonePlayerId: "b" },
        to: { kind: "board-battlefield", locationId: targetField.locationId } }] };
  }) as DuelCanonicalPlayingStateV2;
  const sourceCard = state.players[0].hand.find(card => card.cardId === point.id)!;
  state = moveDuelPhysicalCardToChainV2(state, referenceDuelPhysicalCardV2(state, sourceCard.uid), "a");
  const sourcePhysical = state.physicalCardsByUID[sourceCard.uid]!;
  const reference = authority.resolvedProgramReference(point.id)!;
  const source = { sourceUID: sourceCard.uid, sourceZoneEpoch: sourcePhysical.zoneEpoch,
    controllerPlayerId: "a", cardId: point.id, programId: reference.programId,
    dataVersion: catalog.dataVersion, catalogDigest: catalog.digest,
    effectId: `point-provider-${targetMight}:effect`, phase: "spell-resolution" as const, window: "main" };
  let head = state;
  const sourceServices = { inspect: () => ({ status: "ready" as const,
    candidates: enumerateDuelPhaseSourceClosureCandidatesV2(head), sources: [], eventSources: [],
    activeSources: [], handlers: [], runtimeSources: [] }),
    derivedMight: (uid: string) => ({ status: "complete" as const, uid, baseMight: targetMight, currentMight: targetMight }) } as any;
  const provider = createDuelPointEffectProductionServicesV1({ currentHead: () => head,
    sourceServices, programAuthority: authority });
  let lethalRequest: any;
  const core = createDuelPointDamageEffectAuthorityV1({ state, source,
    registry: getCardProgramRegistryForRuntime(authority), readHead: () => head,
    verifyCost: () => ({ status: "approved", proofId: "fixture-cost" }),
    verifyChain: () => ({ status: "approved", proofId: "fixture-chain", selectionTiming: "finalization" }),
    resolveDamage: provider.resolveDamage,
    resolveLethal: request => {
      lethalRequest = request;
      return provider.resolveLethal(request);
    } });
  beginDuelPointDamageEffectV1(core);
  const result = submitDuelPointDamageEffectChoiceV1(core, { expectedStateVersion: state.stateVersion,
    actorPlayerId: "a", targetUIDs: [targetCard.uid] });
  return { result, targetUID: targetCard.uid, provider, lethalRequest };
}

describe("Point effect production services V1", () => {
  it("requires a positive, identity guarded Point catalog authority", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtime);
    expect(authority.census.resolvedPrograms).toBeGreaterThan(0);
    expect(() => createDuelPointEffectProductionServicesV1({
      currentHead: () => null,
      sourceServices: sources(),
      programAuthority: { ...authority },
    })).toThrow(/genuine Point program authority/);
  });

  it("keeps an unknown current head or closure pending", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtime);
    const provider = createDuelPointEffectProductionServicesV1({
      currentHead: () => null,
      sourceServices: sources(),
      programAuthority: authority,
    });
    expect(provider.resolveDamage({} as never)).toEqual({
      status: "pending", reason: "point-source-or-closure-pending",
    });
    expect(provider.resolveLethal({} as never)).toEqual({
      status: "pending", reason: "point-lethal-proposal-pending",
    });
  });

  it("does not treat a getter or JSON clone as a proposal", () => {
    const authority = createDuelPointDamageCardProgramAuthorityV1(runtime);
    const head = {} as DuelCanonicalPlayingStateV2;
    const provider = createDuelPointEffectProductionServicesV1({
      currentHead: () => head,
      sourceServices: sources(),
      programAuthority: authority,
    });
    const malicious = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(malicious, "state", { get: () => { throw new Error("getter"); } });
    expect(provider.resolveLethal(malicious as never).status).toBe("pending");

    const fixture = coreFixture(4);
    const clonedRequest = {
      ...fixture.lethalRequest,
      plan: JSON.parse(JSON.stringify(fixture.lethalRequest.plan)),
      proposedDamage: JSON.parse(JSON.stringify(fixture.lethalRequest.proposedDamage)),
    };
    expect(fixture.provider.resolveLethal(clonedRequest as never).status).toBe("pending");
  });

  it("runs a real Core Point authority through nonlethal and lethal fixture targets", () => {
    const nonlethal = coreFixture(4).result;
    expect(nonlethal.status).toBe("complete");
    expect(nonlethal.notices).toHaveLength(0);
    const lethal = coreFixture(1).result;
    expect(lethal.status).toBe("complete");
    expect(lethal.notices.some(notice => notice.kind === "Killed")).toBe(true);
  });
});
