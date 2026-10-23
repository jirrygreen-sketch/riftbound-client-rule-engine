import { describe, expect, it } from "vitest";
import {
  rankHeadlessBotCommands,
  replayHeadlessJournal,
  runHeadlessGame,
  type HeadlessCommand,
  type HeadlessCommandTrace,
  type HeadlessCommandTraceObject,
  type HeadlessJournal,
} from "../../src/headless/duel.js";

const ref = (id: string) => ({ id, zoneEntryId: 1 });

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
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame("RIFT-857-m1-seed-001", {
      decks: ["rumble-sfd", "fiora-sfd"],
      onJournal: value => { journal = value; },
    });
    expect(result.termination).toBe("blocked");
    expect(result.winner).toBeNull();
    expect(result.guardReason).toBeNull();
    expect(result.blockers).toEqual([
      expect.objectContaining({ name: "ProgramBindingError", code: "judge-required" }),
    ]);
    expect(result.judgeRequiredCards).toContain(
      "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
    );
    expect(Object.values(result.actionCoverage.commands).every(count => count === 0)).toBe(true);
    expect(journal).toBeDefined();
    expect(journal!.commands).toEqual([]);
    expect(journal!.setupBlockers).toEqual(result.blockers);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.privacyChecks).toBeGreaterThan(0);
    expect(replayHeadlessJournal(journal!)).toBe(true);
    expect(replayHeadlessJournal({ ...journal!, setupBlockers: [] })).toBe(false);
  }, 60_000);

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
});
