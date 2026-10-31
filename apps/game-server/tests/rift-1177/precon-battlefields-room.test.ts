import { describe, expect, it } from "vitest";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  PLAYER_1,
  PLAYER_2,
  accepted,
  fundEnergy,
  fundPower,
  nextOwnMain,
  openMain,
  ownedBoard,
  ownedHand,
  pendingChoice,
  projection,
  settle,
  settlePlay,
  startRoom,
} from "./helpers.js";

// Official card text and evidence:
// Gallery (zh_CN), read 2026-10-31:
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// Core Rules v1.5, published 2026-10-09, effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Minefield: 053.3, 170.2, 190.6, 383.4.c.2, 471.1, 472, 473.2.
// Ravenbloom: same Defend/Battlefield refs plus 383.4.f, 425.1/.1.a.2,
// 425.2.a, 417.1/.1.a/.1.c and 466.2.
// Ornn's Forge: 185.3.a, 186.1, 190.6, 356.4, 420.4.b.
// Sunken Temple: 190.6, 383.2.a.1, 383.3.a/b, 405.1/.2, 473.2,
// 706, 708, 710; no Radiance or Spiritforged card-specific ruling.
// Veiled Temple: 190.6, 355.7/.12, 383.3.a/.a.3, 403, 405.2,
// 416.1/.1.c, 436.1/.1.a.1, 436.2/.3, 473.2; no card-specific ruling.

const PORO = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";

function battlefieldId(view: V2Projection, name: string): string {
  const source = view.objects.find(object => object.name === name && object.zone === "board" &&
    object.location?.kind === "battlefield");
  expect(source, JSON.stringify(view.objects.filter(object => object.zone === "board"))).toBeDefined();
  expect(source!.location?.kind).toBe("battlefield");
  if (source!.location?.kind !== "battlefield") throw new Error(`Missing location for ${name}`);
  return source!.location.battlefieldId;
}

function moveToBattlefield(started: Awaited<ReturnType<typeof startRoom>>, playerId: string,
  objectId: string, battlefield: string, prefix: string): void {
  const view = projection(started, playerId);
  accepted(started, playerId, {
    type: "move", commandId: `${prefix}:move:${view.stateVersion}`, stateVersion: view.stateVersion,
    objectId, to: { zone: "battlefield", locationId: battlefield },
  });
}

function playToBase(started: Awaited<ReturnType<typeof startRoom>>, playerId: string,
  objectId: string, prefix: string): void {
  const view = projection(started, playerId);
  accepted(started, playerId, {
    type: "play", commandId: `${prefix}:play`, stateVersion: view.stateVersion,
    cardObjectId: objectId, destination: { kind: "base", playerId },
  });
  settlePlay(started, playerId, `${prefix}:play-settle`);
}

function passShowdown(started: Awaited<ReturnType<typeof startRoom>>, prefix: string): void {
  for (let index = 0; index < 8; index += 1) {
    const view = projection(started, PLAYER_1);
    if (view.pendingChoice.status === "pending") return;
    if (view.chain.focusPlayerId === null) {
      if (view.chain.items.length > 0) {
        const actor = view.chain.priorityPlayerId;
        if (actor === null) throw new Error(`Missing priority at ${prefix}`);
        accepted(started, actor, { type: "pass", commandId: `${prefix}:chain:${index}`, stateVersion: view.stateVersion });
        continue;
      }
      return;
    }
    const focusActor = [PLAYER_1, PLAYER_2].find(playerId =>
      projection(started, playerId).viewerPlayerId === playerId &&
      projection(started, playerId).actionOptions.canPass === true) ?? view.chain.focusPlayerId;
    accepted(started, focusActor, {
      type: "pass", commandId: `${prefix}:focus:${index}`, stateVersion: view.stateVersion,
    });
  }
  throw new Error(`Showdown did not close at ${prefix}`);
}

describe("RIFT-1177 precon battlefields in the real room path", () => {
  it("Minefield burns exactly two cards after a real conquest", async () => {
    const started = await startRoom("RIFT-1177-room-1", "rumble-sfd", "fiora-sfd", 0);
    const opening = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "minefield-poro");
    const unit = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Gem Jammer");
    expect(unit).toBeDefined();
    playToBase(started, PLAYER_1, unit!.objectId, "minefield-unit");
    const plaza = nextOwnMain(started, PLAYER_1, opening.turnNumber);
    const before = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    moveToBattlefield(started, PLAYER_1, unit!.objectId, battlefieldId(plaza, "Minefield"), "minefield");
    passShowdown(started, "minefield-conquer");
    settle(started, PLAYER_1, "minefield-resolve");
    const after = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    expect(after.zoneCounts.trash).toBe((before.zoneCounts.trash ?? 0) + 2);
    expect(after.deckCount).toBe(before.deckCount - 2);
  }, 180_000);

  it("Ravenbloom recycles a revealed non-spell", async () => {
    const started = await startRoom("RIFT-1177-room-1", "rumble-sfd", "fiora-sfd", 1);
    const opening = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "ravenbloom-poro");
    const poro = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.cardId === PORO);
    expect(poro).toBeDefined();
    playToBase(started, PLAYER_1, poro!.objectId, "ravenbloom-poro");
    let view = nextOwnMain(started, PLAYER_1, opening.turnNumber);
    const ravenbloom = battlefieldId(view, "Ravenbloom Conservatory");
    moveToBattlefield(started, PLAYER_1, poro!.objectId, ravenbloom, "ravenbloom-conquer");
    passShowdown(started, "ravenbloom-conquer");
    settle(started, PLAYER_1, "ravenbloom-conquer-resolve");
    expect(projection(started, PLAYER_1).battlefields.find(field => field.battlefieldId === ravenbloom)?.controllerPlayerId)
      .toBe(PLAYER_1);
    view = nextOwnMain(started, PLAYER_2, projection(started, PLAYER_2).turnNumber);
    fundEnergy(started, PLAYER_2, 4, "ravenbloom-attacker");
    const attacker = ownedHand(projection(started, PLAYER_2), PLAYER_2)
      .find(object => object.name === "Unsung Hero");
    expect(attacker).toBeDefined();
    playToBase(started, PLAYER_2, attacker!.objectId, "ravenbloom-attacker");
    view = nextOwnMain(started, PLAYER_2, projection(started, PLAYER_2).turnNumber);
    const defenderBefore = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    moveToBattlefield(started, PLAYER_2, attacker!.objectId, ravenbloom, "ravenbloom-defend");
    passShowdown(started, "ravenbloom-defend");
    settle(started, PLAYER_1, "ravenbloom-defend-resolve");
    const defenderAfter = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    const defenseEvents = projection(started, PLAYER_1).events;
    expect(defenseEvents.filter(event => event.timingPoint === "card-revealed").length).toBeGreaterThan(0);
    expect(defenseEvents.filter(event => event.timingPoint === "card-recycled").length).toBeGreaterThan(0);
    expect(defenderAfter.zoneCounts.hand).toBe(defenderBefore.zoneCounts.hand);
    expect(defenderAfter.deckCount).toBe(defenderBefore.deckCount);
  }, 180_000);

  it("Ornn's Forge discounts only the first friendly non-token Gear each turn", async () => {
    const started = await startRoom("RIFT-1177-seed-27", "fiora-sfd", "rumble-sfd", 0);
    const opening = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "forge-gear");
    const rookie = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Pit Rookie");
    expect(rookie).toBeDefined();
    playToBase(started, PLAYER_1, rookie!.objectId, "forge-rookie");
    const conquestTurn = nextOwnMain(started, PLAYER_1, opening.turnNumber);
    moveToBattlefield(started, PLAYER_1, rookie!.objectId,
      battlefieldId(conquestTurn, "Ornn's Forge"), "forge-conquer");
    passShowdown(started, "forge-conquer");
    settle(started, PLAYER_1, "forge-conquer-resolve");
    expect(projection(started, PLAYER_1).battlefields.find(field =>
      field.controllerPlayerId === PLAYER_1)?.battlefieldId).toBeDefined();

    fundEnergy(started, PLAYER_1, 4, "forge-play-gears");
    const hand = ownedHand(projection(started, PLAYER_1), PLAYER_1);
    const armor = hand.find(object => object.name === "Warmog's Armor");
    const blade = hand.find(object => object.name === "Doran's Blade");
    expect(armor).toBeDefined();
    expect(blade).toBeDefined();
    expect(projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)?.energy).toBe(4);
    playToBase(started, PLAYER_1, armor!.objectId, "forge-first-gear");
    // Warmog's Armor has 1 printed Energy; the first Gear discount makes it 0.
    expect(projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)?.energy).toBe(4);
    playToBase(started, PLAYER_1, blade!.objectId, "forge-second-gear");
    // Doran's Blade has 2 printed Energy and is the second Gear, so it pays full cost.
    expect(projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)?.energy).toBe(2);
    expect(ownedBoard(projection(started, PLAYER_1), PLAYER_1).filter(object =>
      object.name === "Warmog's Armor" || object.name === "Doran's Blade")).toHaveLength(2);
  }, 180_000);

  it("Sunken Temple offers its pay-and-draw choice only to a Mighty conqueror", async () => {
    const started = await startRoom("RIFT-1177-exact-14", "fiora-sfd", "rumble-sfd", 2);
    let view = openMain(started, PLAYER_1);
    const yone = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Yone");
    expect(yone).toBeDefined();
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    // Seat A is last and channels 3 runes on its first Channel Phase. Its next
    // own turn readies those 3 and channels 2 more, yielding the 5 Energy
    // needed by Yone without any test-only resource grant.
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    fundEnergy(started, PLAYER_1, 5, "sunken-yone");
    fundPower(started, PLAYER_1, "Body Rune", 1, "sunken-yone-power");
    playToBase(started, PLAYER_1, yone!.objectId, "sunken-yone");
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const temple = battlefieldId(view, "Sunken Temple");
    fundEnergy(started, PLAYER_1, 1, "sunken-pay");
    moveToBattlefield(started, PLAYER_1, yone!.objectId, temple, "sunken");
    passShowdown(started, "sunken-conquer");
    const ordering = pendingChoice(started, PLAYER_1);
    expect(ordering).toMatchObject({ kind: "mode" });
    const sunkenOption = ordering.options?.find(option => option.label === "Sunken Temple");
    expect(sunkenOption, JSON.stringify(ordering.options)).toBeDefined();
    accepted(started, PLAYER_1, { type: "choose", commandId: "sunken-order",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: ordering.choiceId,
      answer: sunkenOption!.value! });
    const choice = pendingChoice(started, PLAYER_1);
    expect(choice).toMatchObject({ kind: "optional", source: { name: "Sunken Temple" } });
    const before = projection(started, PLAYER_1);
    accepted(started, PLAYER_1, { type: "choose", commandId: "sunken-decline",
      stateVersion: before.stateVersion, choiceId: choice.choiceId, answer: false });
    const after = projection(started, PLAYER_1);
    expect(after.players.find(player => player.playerId === PLAYER_1)?.energy)
      .toBe(before.players.find(player => player.playerId === PLAYER_1)?.energy);
    expect(after.pendingChoice).toEqual({ status: "none" });
  }, 180_000);

  it("Sunken Temple pays one Energy and draws on acceptance", async () => {
    const started = await startRoom("RIFT-1177-exact-14", "fiora-sfd", "rumble-sfd", 2);
    let view = openMain(started, PLAYER_1);
    const yone = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Yone");
    expect(yone).toBeDefined();
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    fundEnergy(started, PLAYER_1, 5, "sunken-accept-yone");
    fundPower(started, PLAYER_1, "Body Rune", 1, "sunken-accept-yone-power");
    playToBase(started, PLAYER_1, yone!.objectId, "sunken-accept-yone");
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const temple = battlefieldId(view, "Sunken Temple");
    fundEnergy(started, PLAYER_1, 1, "sunken-accept-pay");
    moveToBattlefield(started, PLAYER_1, yone!.objectId, temple, "sunken-accept");
    passShowdown(started, "sunken-accept-conquer");
    const ordering = pendingChoice(started, PLAYER_1);
    expect(ordering.kind).toBe("mode");
    const sunkenOption = ordering.options?.find(option => option.label === "Sunken Temple");
    expect(sunkenOption, JSON.stringify(ordering.options)).toBeDefined();
    accepted(started, PLAYER_1, { type: "choose", commandId: "sunken-accept-order",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: ordering.choiceId,
      answer: sunkenOption!.value! });
    const choice = pendingChoice(started, PLAYER_1);
    expect(choice).toMatchObject({ kind: "optional", source: { name: "Sunken Temple" } });
    const before = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    accepted(started, PLAYER_1, { type: "choose", commandId: "sunken-accept",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: choice.choiceId, answer: true });
    settle(started, PLAYER_1, "sunken-accept-resolve");
    const after = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    expect(after.energy).toBe(before.energy - 1);
    expect(after.handCount).toBe(before.handCount + 1);
  }, 180_000);

  it("Sunken Temple does not prompt for a non-Mighty conqueror", async () => {
    const started = await startRoom("RIFT-1177-exact-0", "fiora-sfd", "rumble-sfd", 2);
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "sunken-rookie");
    const rookie = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Pit Rookie");
    expect(rookie).toBeDefined();
    playToBase(started, PLAYER_1, rookie!.objectId, "sunken-rookie");
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const temple = battlefieldId(view, "Sunken Temple");
    moveToBattlefield(started, PLAYER_1, rookie!.objectId, temple, "sunken-non-mighty");
    passShowdown(started, "sunken-non-mighty-conquer");
    settle(started, PLAYER_1, "sunken-non-mighty-resolve");
    expect(projection(started, PLAYER_1).pendingChoice).toEqual({ status: "none" });
    expect(projection(started, PLAYER_1).objects.find(object => object.objectId === rookie!.objectId))
      .toMatchObject({ zone: "board", location: { kind: "battlefield", battlefieldId: temple } });
  }, 180_000);

  it("Veiled Temple readies a friendly Gear and permits a real Equipment detach", async () => {
    const started = await startRoom("RIFT-1177-veiled-seed-4", "fiora-sfd", "rumble-sfd", 1);
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "veiled-unit");
    const unit = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Pit Rookie");
    expect(unit).toBeDefined();
    playToBase(started, PLAYER_1, unit!.objectId, "veiled-unit");
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    fundEnergy(started, PLAYER_1, 1, "veiled-blade");
    const blade = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Warmog's Armor");
    expect(blade).toBeDefined();
    playToBase(started, PLAYER_1, blade!.objectId, "veiled-blade");
    fundPower(started, PLAYER_1, "Body Rune", 1, "veiled-equip");
    const equipView = projection(started, PLAYER_1);
    accepted(started, PLAYER_1, { type: "activate", commandId: "veiled-equip",
      stateVersion: equipView.stateVersion, sourceObjectId: blade!.objectId, abilityId: "0" });
    const equipChoice = pendingChoice(started, PLAYER_1);
    expect(equipChoice.kind).toBe("select-objects");
    const host = equipChoice.options?.find(option => option.objectRef?.objectId === unit!.objectId);
    expect(host, JSON.stringify(equipChoice.options)).toBeDefined();
    accepted(started, PLAYER_1, { type: "choose", commandId: "veiled-equip-host",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: equipChoice.choiceId,
      answer: [host!.objectRef!] });
    settle(started, PLAYER_1, "veiled-equip-settle");
    const temple = battlefieldId(view, "Veiled Temple");
    moveToBattlefield(started, PLAYER_1, unit!.objectId, temple, "veiled");
    passShowdown(started, "veiled-conquer");
    const leading = pendingChoice(started, PLAYER_1);
    expect(leading).toMatchObject({ kind: "optional", source: { name: "Veiled Temple" } });
    accepted(started, PLAYER_1, { type: "choose", commandId: "veiled-accept-ready",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: leading.choiceId, answer: true });
    const gearChoice = pendingChoice(started, PLAYER_1);
    expect(gearChoice.kind).toBe("select-objects");
    const gear = gearChoice.options?.find(option => option.objectRef?.objectId === blade!.objectId);
    expect(gear, JSON.stringify(gearChoice.options)).toBeDefined();
    accepted(started, PLAYER_1, { type: "choose", commandId: "veiled-ready-gear",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: gearChoice.choiceId,
      answer: [gear!.objectRef!] });
    expect(projection(started, PLAYER_1).events.filter(event =>
      event.timingPoint === "object-attached" &&
      event.payload.objectId?.value === blade!.objectId).length).toBeGreaterThan(0);
    passShowdown(started, "veiled-post-finalize");
    const detachChoice = pendingChoice(started, PLAYER_1);
    expect(detachChoice).toMatchObject({ kind: "optional", source: { name: "Veiled Temple" } });
    accepted(started, PLAYER_1, { type: "choose", commandId: "veiled-accept-detach",
      stateVersion: projection(started, PLAYER_1).stateVersion, choiceId: detachChoice.choiceId, answer: true });
    settle(started, PLAYER_1, "veiled-detach-settle");
    expect(projection(started, PLAYER_1).pendingChoice).toEqual({ status: "none" });
    expect(projection(started, PLAYER_1).objects.find(object => object.objectId === blade!.objectId))
      .toMatchObject({ zone: "board", exhausted: false });
  }, 180_000);
});
