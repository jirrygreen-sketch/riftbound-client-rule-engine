import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import confront from "../../../card-dsl/dist/cards/ogn/confront.js";
import { cardPrograms } from "../../../card-dsl/dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import { createMatch, type MatchCard, type MatchHost } from "../../../engine-core/dist/game/lifecycle.js";
import { world } from "../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import {
  headlessBotAnswer,
  rankHeadlessBotCommands,
  replayHeadlessJournal,
  runHeadlessGame,
  type HeadlessCommand,
  type HeadlessCommandTrace,
  type HeadlessCommandTraceObject,
  type HeadlessJournal,
} from "../../src/headless/duel.js";

const ref = (id: string) => ({ id, zoneEntryId: 1 });

const blockerCardId = confront.canonicalCardId;

function harnessCard(id: string, name: string, types: readonly string[], seat: "A" | "B"): MatchCard {
  return { id: `${seat}:${id}`, cardId: `synthetic:${seat}:${id}`, name, types,
    energy: 0, power: null, might: null };
}

function blockerDeck(seat: "A" | "B") {
  return {
    mainDeck: Array.from({ length: 8 }, (_, index) => harnessCard(`main-${index}`, `Main ${index}`, ["unit"], seat)),
    runeDeck: Array.from({ length: 8 }, (_, index) => harnessCard(`rune-${index}`, `Rune ${index}`, ["rune"], seat)),
    championLegend: harnessCard("legend", "Legend", ["legend"], seat),
    chosenChampion: harnessCard("champion", "Champion", ["champion"], seat),
    battlefields: [
      harnessCard("field-1", "Field 1", ["battlefield"], seat),
      harnessCard("field-2", "Field 2", ["battlefield"], seat),
      harnessCard("field-3", "Field 3", ["battlefield"], seat),
    ] as const,
  };
}

function runProductionSetupBlocker() {
  const kernel = world().player("A").player("B").build();
  const hostBase = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      const checkpoint = saved as {
        readonly state: Parameters<typeof kernel.restore>[0];
        readonly links: Parameters<typeof kernel.copyLinkedFrom>[0];
      };
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: () => { throw new Error("Setup blocker test must not make a game choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(hostBase)), hostBase,
    { player: (id: "A" | "B") => kernel.player(id) }) as MatchHost;
  const binding = createProgramBinding({ cardPrograms: cardPrograms as unknown as readonly CardProgram[] });
  const match = createMatch({ host, decks: [blockerDeck("A"), blockerDeck("B")],
    programs: binding, seed: "RIFT-1059-confront-blocker", battlefieldChoice: [0, 0],
    mulligans: [[], []], firstPlayer: 0 });
  const failures: Array<{ readonly error: unknown; readonly cardId: string | null }> = [];
  binding.attachLifecycle(match.flow.chain, (error, source) => failures.push({ error, cardId: source.cardId }));
  match.flow.chain.commit({ type: "create-token", player: "A", to: "board",
    token: { cardId: blockerCardId, name: "Confront", types: ["spell"], tags: [],
      energy: null, power: null, might: null },
    location: { type: "base", player: "A" } });
  return { failures };
}

function boardUnit(
  id: string,
  controller: "A" | "B",
  location: { readonly type: "base"; readonly player: "A" | "B" } |
    { readonly type: "battlefield"; readonly id: string },
  might: number | null,
): HeadlessCommandTraceObject {
  return { id, cardId: `card:${id}`, name: id, controller,
    zone: "board", location, exhausted: false, canMove: true, canGank: false,
    might, movementRestrictions: [] };
}

function trace(
  boardUnits: readonly HeadlessCommandTraceObject[],
  candidates: readonly HeadlessCommand[],
  fields: readonly { readonly id: string; readonly controller: "A" | "B" | null }[],
  runePool = { A: { energy: 3, power: [] }, B: { energy: 3, power: [] } },
  unitEnergy = 2,
): HeadlessCommandTrace {
  return {
    turn: 1,
    turnPlayer: "A",
    phase: "main",
    priority: "A",
    focus: null,
    turnState: "neutral-open",
    canActNormal: true,
    candidateCounts: { play: candidates.filter(value => value.type === "play").length,
      idle: 0, pass: 0, advance: 0, move: candidates.filter(value => value.type === "move").length,
      "rune-energy": candidates.filter(value => value.type === "rune-energy").length,
      "combat-damage": 0, concede: 0 },
    battlefields: fields.map(field => ({ ...field, contestedBy: null, staged: "none" as const })),
    boardUnits,
    basicRunes: [],
    runePool,
    candidates: candidates.flatMap(command => command.type !== "play" && command.type !== "rune-energy"
      ? [] : [{
        type: command.type,
        id: command.type === "play" || command.type === "rune-energy" ? command.id : null,
        name: "test",
        object: command.object,
        energy: command.type === "play" && command.object.id === "unit-play" ? unitEnergy : null,
        power: null,
        types: command.type === "play" ? ["unit"] : ["rune"],
        destination: command.type === "play" ? { type: "base" as const, player: "A" as const } : null,
      }]),
    canEndTurn: true,
    emptyRunePoolBlocked: false,
  };
}

describe("headless bot command strategy", () => {
  it("journals an active setup blocker without inventing gameplay or a winner", () => {
    // Both M1 precons are executable now, so they cannot reproduce a setup
    // blocker. RIFT-1057 made Assembly Rig executable, so use Confront, which
    // remains judge-required in the production registry; place that real source
    // on a Match and observe the production lifecycle.
    const started = performance.now();
    const { failures } = runProductionSetupBlocker();
    const elapsedMs = performance.now() - started;
    expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({
      cardId: confront.canonicalCardId,
      error: expect.objectContaining({ name: "ProgramBindingError", code: "judge-required" }),
    })]));
    expect(confront.status).toBe("judge-required");
    expect(confront.judgeReason).toBeTruthy();
    expect(elapsedMs).toBeLessThan(10_000);

    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame("RIFT-857-m1-seed-001", {
      decks: ["vex-unl", "vi-unl"],
      onJournal: value => { journal = value; },
    });
    expect(result.termination).toBe("blocked");
    expect(result.winner).toBeNull();
    expect(result.guardReason).toBeNull();
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.every(blocker =>
      blocker.name === "ProgramBindingError" && blocker.code === "judge-required")).toBe(true);
    expect(result.judgeRequiredCards.length).toBeGreaterThan(0);
    expect(Object.values(result.actionCoverage.commands).every(count => count === 0)).toBe(true);
    expect(journal).toBeDefined();
    expect(journal!.commands).toEqual([]);
    expect(journal!.setupBlockers).toEqual(result.blockers);
    expect(result.replayMatches).toBe(true);
    expect(replayHeadlessJournal(journal!)).toBe(true);
    expect(replayHeadlessJournal({ ...journal!, setupBlockers: [] })).toBe(false);
    expect(result.privacySafe).toBe(true);
    expect(result.privacyChecks).toBeGreaterThan(0);
  });

  it("plays an affordable Unit even when an owned board Unit already exists", () => {
    const play: HeadlessCommand = { type: "play", player: "A", object: ref("unit-play"),
      id: "play:unit", location: { type: "base", player: "A" } };
    const move: HeadlessCommand = { type: "move", player: "A", object: ref("a-base"),
      to: { type: "battlefield", id: "empty" } };
    const tiers = rankHeadlessBotCommands([move, play], trace([
      boardUnit("a-base", "A", { type: "base", player: "A" }, 3),
    ], [move, play], [{ id: "empty", controller: null }]));
    expect(tiers[0]).toEqual({ priority: "affordable-unit-play", commands: [play] });
    expect(tiers[1]).toEqual({ priority: "open-field-move", commands: [move] });
  });

  it("uses the existing Rune resource commands before accumulating more board Units", () => {
    const unit: HeadlessCommand = { type: "play", player: "A", object: ref("unit-play"),
      id: "play:unit", location: { type: "base", player: "A" } };
    const rune: HeadlessCommand = { type: "rune-energy", player: "A", object: ref("rune"), id: "rune:1" };
    const sample = trace([], [unit, rune], [{ id: "empty", controller: null }],
      { A: { energy: 1, power: [] }, B: { energy: 1, power: [] } });
    expect(rankHeadlessBotCommands([unit, rune], sample)[0])
      .toEqual({ priority: "rune-energy", commands: [rune] });
  });

  it("does not promote an unaffordable Unit into the affordable-play tier", () => {
    const unit: HeadlessCommand = { type: "play", player: "A", object: ref("unit-play"),
      id: "play:unit", location: { type: "base", player: "A" } };
    const move: HeadlessCommand = { type: "move", player: "A", object: ref("a-base"),
      to: { type: "battlefield", id: "empty" } };
    const sample = trace([
      boardUnit("a-base", "A", { type: "base", player: "A" }, 3),
    ], [unit, move], [{ id: "empty", controller: null }], {
      A: { energy: 1, power: [] }, B: { energy: 3, power: [] },
    }, 2);
    const tiers = rankHeadlessBotCommands([unit, move], sample);
    expect(tiers.some(tier => tier.priority === "affordable-unit-play")).toBe(false);
    expect(tiers.flatMap(tier => tier.commands)).not.toContainEqual(unit);
    expect(tiers[0]).toEqual({ priority: "open-field-move", commands: [move] });
  });

  it("orders battlefield moves by enemy combat value and defers Base retreats", () => {
    const winning: HeadlessCommand = { type: "move", player: "A", object: ref("a-two"),
      to: { type: "battlefield", id: "enemy" } };
    const losing: HeadlessCommand = { type: "move", player: "A", object: ref("a-one"),
      to: { type: "battlefield", id: "stronger-enemy" } };
    const open: HeadlessCommand = { type: "move", player: "A", object: ref("a-one"),
      to: { type: "battlefield", id: "empty" } };
    const controlled: HeadlessCommand = { type: "move", player: "A", object: ref("a-one"),
      to: { type: "battlefield", id: "owned" } };
    const retreat: HeadlessCommand = { type: "move", player: "A", object: ref("retreater"),
      to: { type: "base", player: "A" } };
    const commands = [retreat, controlled, losing, open, winning];
    const tiers = rankHeadlessBotCommands(commands, trace([
      boardUnit("a-one", "A", { type: "base", player: "A" }, 1),
      boardUnit("a-two", "A", { type: "base", player: "A" }, 2),
      boardUnit("retreater", "A", { type: "battlefield", id: "owned" }, 4),
      boardUnit("enemy", "B", { type: "battlefield", id: "enemy" }, 2),
      boardUnit("strong-enemy", "B", { type: "battlefield", id: "stronger-enemy" }, 3),
    ], commands, [
      { id: "enemy", controller: "B" },
      { id: "stronger-enemy", controller: "B" },
      { id: "empty", controller: null },
      { id: "owned", controller: "A" },
    ]));
    expect(tiers.map(tier => tier.priority)).toEqual([
      "winning-enemy-move", "enemy-move", "open-field-move", "controlled-field-move", "base-move",
    ]);
    expect(tiers[0]!.commands[0]!.type).toBe("move");
    expect(tiers[1]!.commands[0]!.type).toBe("move");
    expect(tiers[2]!.commands).toContainEqual(open);
    expect(tiers[3]!.commands).toContainEqual(controlled);
    expect(tiers[4]!.commands).toEqual([retreat]);
  });

  it("does not treat an unknown or null Might as a winning attack", () => {
    const move: HeadlessCommand = { type: "move", player: "A", object: ref("a-one"),
      to: { type: "battlefield", id: "enemy" } };
    const tiers = rankHeadlessBotCommands([move], trace([
      boardUnit("a-one", "A", { type: "base", player: "A" }, 5),
      boardUnit("unknown-enemy", "B", { type: "battlefield", id: "enemy" }, null),
    ], [move], [{ id: "enemy", controller: "B" }]));
    expect(tiers[0]?.priority).toBe("enemy-move");
  });

  it("answers the Weaponmaster payment mode with one of its two legal choices", () => {
    const request = {
      id: "weaponmaster:pay:lucian:1:1",
      type: "mode" as const,
      chooser: "A" as const,
      visibility: "public" as const,
      prompt: "B.F. Sword的装配费用：1 点序理符能，当前不足。",
      options: ["支付", "放弃装配"] as const,
    };
    expect(headlessBotAnswer(() => 0, request)).toBe("支付");
    expect(headlessBotAnswer(() => 1, request)).toBe("放弃装配");
  });
});
