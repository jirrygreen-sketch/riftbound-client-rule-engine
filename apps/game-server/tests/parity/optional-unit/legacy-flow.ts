import { expect } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelWireCommandV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../../src/card-catalog.js";
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN } from "../../../src/duel/command-journal-p4.js";
import { fury77RealDecks } from "../../duel/fixtures/fury77-real-decks.js";
import type { optionalUnits } from "./scenarios.js";

export type OptionalUnit = typeof optionalUnits[number];
export type Decision = "pay" | "decline";
export const routes = [
  { name: "current choice clock", profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK, physical: false },
  { name: "physical Chain", profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN, physical: true },
] as const;

/** All setup/turn/funding changes go through the existing command owner. */
export async function legacyFlow(unit: OptionalUnit, route: typeof routes[number], label: string) {
  const catalog = await loadCardCatalogRuntime();
  for (const deck of Object.values(fury77RealDecks)) {
    expect(validateCatalogDeck(catalog, deck)).toMatchObject({ valid: true, issues: [] });
  }
  let uid = 0, commandSeq = 0;
  const options = { catalog, matchId: `optional-parity-${unit.printingId}-${route.physical}-${label}`,
    randomIndex: () => 0, uidFactory: () => `optional-parity-${++uid}`,
    roster: [{ playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
      { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b }] as const };
  let recorded = createDuelRecordedRuntimeP4(options, route.profile);
  const acceptedCommandTypes: string[] = [];
  const project = (viewer: string | null = "alice") => recorded.runtime.project(viewer);
  const playing = (viewer: string | null = "alice") => {
    const view = project(viewer);
    if (view.match.stage !== "playing") throw new Error("Command owner must reach Playing normally");
    return view as typeof view & { match: Extract<typeof view.match, { stage: "playing" }> };
  };
  const views = () => [project("alice"), project("bob"), project(null)];
  const send = (actor: string, command: DuelWireCommandV3Actions1, expectedVersion = project(actor).match.stateVersion) => {
    const commandId = `parity-command-${++commandSeq}`;
    const packet = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: commandId, commandId, expectedVersion, command };
    const result = recorded.runtime.dispatch(actor, packet);
    if (result.ack.ok && !result.ack.duplicate) acceptedCommandTypes.push(command.type);
    return { packet, result };
  };
  const accepted = (actor: string, command: DuelWireCommandV3Actions1) => {
    const dispatched = send(actor, command);
    expect(dispatched.result.ack, `${actor} ${command.type}`).toMatchObject({ type: "request-result", ok: true });
    return dispatched;
  };
  const restart = () => {
    const before = views();
    const archive = recorded.archive();
    recorded = replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(options,
      digestDuelCommandArchiveP4(archive), route.profile));
    expect(views()).toEqual(before);
    // The replay archive omits rejected/duplicate diagnostic operations. The
    // canonical accepted-command journal and all actual views must be exact.
    expect(recorded.archive().journal).toEqual(archive.journal);
  };
  for (let count = 0; count < 2; count++) {
    const setup = project(null).match;
    if (setup.stage !== "setup") throw new Error("Actual mulligan required");
    accepted(setup.setup.currentMulliganOwner!, { type: "mulligan", selectedUIDs: [] });
  }
  while (playing(null).match.frame.turnNumber < unit.turn) {
    const actor = playing(null).match.frame.turnPlayerId;
    const end = playing(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
    if (!end || end.kind !== "end-turn") throw new Error("Enabled End command required");
    accepted(actor, { type: "end-turn", windowId: end.windowId });
  }
  const target = playing().match.players.find(player => player.playerId === "alice")!.hand!
    .find(card => card.cardId === unit.printingId);
  if (!target) throw new Error(`${unit.name} must be dealt by the actual seeded setup`);
  const play = playing().actions.find(action => action.kind === "play-card" && action.cardUID === target.uid && action.enabled);
  if (!play || play.kind !== "play-card") throw new Error("Enabled optional Unit Play required");
  const beforePlay = playing();
  accepted("alice", { type: "play-card", cardUID: target.uid, windowId: play.windowId });
  const choice = playing().match.frame.pendingChoice;
  if (!choice || !("kind" in choice) || choice.kind !== "play-choices") throw new Error("Actual optional cost choice required");
  const prompt = choice.prompts[0]!;
  const answer = (decision: Decision): DuelWireCommandV3Actions1 => {
    const option = prompt.options.find(item => item.label === (decision === "pay" ? "支付额外费用" : "不支付额外费用"));
    if (!option) throw new Error("Actual pay/decline option required");
    return { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: [option.id] }] };
  };
  return { unit, route, catalog, target, beforePlay, choice, prompt, answer,
    project, playing, views, send, accepted, restart, acceptedCommandTypes,
    duplicate: (actor: string, packet: ReturnType<typeof send>["packet"]) => recorded.runtime.dispatch(actor, packet),
    archive: () => recorded.archive() };
}
