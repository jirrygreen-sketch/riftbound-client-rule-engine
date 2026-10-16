import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/temporal-breach.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e46bda69cb88452c9e7cb8c2e3a6b27055ded66d7aa1466494cfd0295ab9e7e6";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Banish a unit, then its owner plays it to the same location, ignoring its cost.";

const [hidden, play] = program.abilities;
const [banishInstruction, playBack] = play.body;
const UNIT = "temporal-breach.unit";

/** effect.banish takes the TargetSpec id as a literal string (the chain adapter decodes it). */
const banishArgs = () => ({
  objects: banishInstruction.args.objects,
  amount: { kind: "constant", value: banishInstruction.args.amount.value },
  linkKey: banishInstruction.args.linkKey
});

test("ven-066-166 Temporal Breach: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-066-166 Temporal Breach: judgeReason names the Hidden cost gaps and the three play-back gaps", () => {
  assert.match(program.judgeReason, /811\.1/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /428/);
  assert.match(program.judgeReason, /124/);
  assert.match(program.judgeReason, /effect\.play/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-066-166 Temporal Breach: printed 2 Energy + 1 Mind Power and a parameterless [Hidden] declaration", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  // 811.1.b prints the Hide cost as :rb_rune_rainbow: (163.2.b Universal Power)
  // and the react cost as [0]; Hidden has no numeric keyword value and no
  // parameter field on KeywordAbility, so neither is invented here.
  assert.equal(Object.hasOwn(hidden, "value"), false);

  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
});

test("ven-066-166 Temporal Breach: structure — banish one unit, then the pending owner play-back", () => {
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "temporal-breach.banish",
    "temporal-breach.play-back"
  ]);

  // 428.1: "Banish a unit" is its own action; 355.7 / 355.9.a.1 make the named
  // Board unit a target.
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: UNIT }
  });
  assert.deepEqual(banishInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(banishInstruction.args.linkKey, {
    kind: "constant",
    value: "temporal-breach.banished"
  });
  assert.deepEqual(banishInstruction.targets, [
    {
      id: UNIT,
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(banishInstruction.linkedTo, undefined);

  // "then its owner plays it to the same location, ignoring its cost" needs the
  // pre-banish location, a per-object owner chooser and a zero-cost plan; the
  // declaration records all three and stays pending (judgeReason).
  assert.equal(playBack.op, "effect.play-back");
  assert.equal(playBack.linkedTo, "temporal-breach.banish");
  assert.deepEqual(playBack.args.objects, {
    kind: "linked-value",
    instructionId: "temporal-breach.banish",
    key: "temporal-breach.banishedObjects"
  });
  assert.deepEqual(playBack.args.chooser, { kind: "constant", value: "owner" });
  assert.deepEqual(playBack.args.destination, { kind: "constant", value: "same-location" });
  assert.deepEqual(playBack.args.ignoreCost, { kind: "constant", value: true });
  assert.equal(playBack.targets, undefined);
  assert.equal(playBack.picks, undefined);
});

test("ven-066-166 Temporal Breach golden: the Banish half really sends the unit to its owner's Banishment", () => {
  const kernel = world()
    .unit("victim", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(banish, banishArgs(), {
    world: kernel,
    targets: { [UNIT]: [kernel.ref("victim")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").zone, "banishment");
  assert.deepEqual(kernel.zone("B", "banishment").map(ref => ref.id), ["victim"]);
  // The link receipt exposes the resulting references for the pending play-back.
  assert.equal(run.linked["temporal-breach.banishedCount"], 1);
  assert.equal(run.linked["temporal-breach.banishedObjects"].length, 1);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("ven-066-166 Temporal Breach golden: a reference that already left the Board is not revived (124 / 359.3.e.7)", () => {
  const kernel = world().unit("victim", { owner: "B", controller: "B" }).build();
  const stale = kernel.ref("victim");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const run = runInstruction(banish, banishArgs(), {
    world: kernel,
    targets: { [UNIT]: [stale] }
  });

  // Every locked reference is stale, so the instruction is ignored rather than
  // looking the object up by id in its new zone.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(run.events, []);
});

test("ven-066-166 Temporal Breach golden: banishing is the Banish action, not Kill or Discard (428.2.a-b)", () => {
  const kernel = world().unit("victim", { owner: "A", controller: "A" }).build();
  const run = runInstruction(banish, banishArgs(), {
    world: kernel,
    targets: { [UNIT]: [kernel.ref("victim")] }
  });

  assert.equal(run.result.status, "executed");
  // The owning player's Banishment zone — never the Trash.
  assert.deepEqual(kernel.zone("A", "banishment").map(ref => ref.id), ["victim"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
});

test.todo(
  "ven-066-166 Temporal Breach: [Hidden]'s Hide action, the [A] hide payment and the [0] facedown play " +
    "(CR 811.1.b / 811.1.d) — the merged keyword only declares static cost.hidden; the cost/zone/timing " +
    "consumers are RIFT-89 / RIFT-91"
);

test.todo(
  "ven-066-166 Temporal Breach: 'its owner plays it to the same location, ignoring its cost' needs the " +
    "pre-banish location (428 + 124 make the old reference unusable), a per-object owner chooser and a " +
    "zero-cost FinalizedCostPlan (356.1.b.1) — effect.play takes one player, one location and an " +
    "already-finalized plan, and no card-program ignore-cost entry point exists (RIFT-89 / RIFT-90)"
);
