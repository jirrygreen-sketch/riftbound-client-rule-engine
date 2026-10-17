import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-harvest.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { mightyCondition } from "../../../../engine-core/dist/effects/keywords/Mighty.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1874eb10cc2af76bced76159e28914196dd012c232435193372275264084a018";
const SOURCE_TEXT = "Kill a unit at a battlefield with 3 :rb_might: or less.";

const [play] = program.abilities;
const [killInstruction] = play.body;
const targetSpec = killInstruction.targets[0];

const baseSnapshot = (overrides = {}) => ({
  ref: { id: "x", zoneEntryId: 1 },
  cardId: "card:x",
  name: "x",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "bf-1" },
  might: 2,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...overrides
});

test("unl-159-219 Soul Harvest: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /mightyCondition/);
});

test("unl-159-219 Soul Harvest: printed 2 energy + 1 Order power and one location-restricted kill", () => {
  // No printed [Action]/[Reaction]: spells default to Action timing (159.2.a),
  // so the program declares no speed keyword.
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(killInstruction.id, "soul-harvest.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "soul-harvest.battlefield-unit"
  });
  assert.equal(killInstruction.linkedTo, undefined);
  // 355.9.a.1 / 355.10.b: the unit is the target and "at a battlefield" is only
  // a restriction; the Might cap stays descriptive (see judgeReason).
  assert.deepEqual(killInstruction.targets, [
    {
      id: "soul-harvest.battlefield-unit",
      filter: { type: "unit", zone: "board", location: "battlefield", mightLte: 3 },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-159-219 Soul Harvest: the merged location restriction matches battlefield units only", () => {
  // The merged layer filter does evaluate the location key, so the restriction
  // this card can rely on is the battlefield one; the Might cap is unmerged.
  assert.equal(
    matchesObjectFilter(targetSpec.filter, baseSnapshot({ location: { type: "battlefield", id: "bf-1" } })),
    true
  );
  assert.equal(
    matchesObjectFilter(targetSpec.filter, baseSnapshot({ location: { type: "base", player: "A" } })),
    false
  );
});

test("unl-159-219 Soul Harvest golden: the merged Mighty threshold predicate is evaluable (CR 708 / 710)", () => {
  // The rule 708 threshold itself is merged as a predicate, so the missing piece
  // is the target-filter vocabulary, not the "Might or less" rule.
  const instruction = (id) => ({
    id,
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: mightyCondition({ canonicalCardId: CANONICAL }) } }
  });
  const strong = world().unit("strong", { owner: "B", controller: "B", might: 6 }).build();
  const weak = world().unit("weak", { owner: "B", controller: "B", might: 2 }).build();
  assert.equal(
    resolveChainBody([instruction("strong")], strong.clone({ sourceSnapshot: strong.getObject("strong") }))
      .results[0].result.linkedValues.value,
    true
  );
  assert.equal(
    resolveChainBody([instruction("weak")], weak.clone({ sourceSnapshot: weak.getObject("weak") }))
      .results[0].result.linkedValues.value,
    false
  );
});

test("unl-159-219 Soul Harvest golden: the merged kill sends the locked battlefield unit to the trash (CR 429.1)", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  const run = runInstruction(
    kill,
    { target: killInstruction.args.target.value },
    { world: kernel, targets: { "soul-harvest.battlefield-unit": [kernel.ref("bf-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("bf-unit").zone, "trash");
  assert.equal(kernel.getObject("base-unit").zone, "board");
  assert.deepEqual(run.linked.killed, [{ id: "bf-unit", zoneEntryId: 1 }]);
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("unl-159-219 Soul Harvest golden: a unit that left the Board is mistargeted (359.3.e.6)", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("bf-unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(
    kill,
    { target: killInstruction.args.target.value },
    { world: kernel, targets: { "soul-harvest.battlefield-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("bf-unit").zone, "hand");
});

test.todo(
  "unl-159-219 Soul Harvest: enforce the '3 :rb_might: or less' targeting restriction at Finalize and re-check it " +
    "at Resolve (CR 355.9.b, 143.2.a effective Might) once TargetSpec.filter can consume a Might-threshold Condition " +
    "(the merged Mighty predicate evaluates, but TargetSpec.filter has no consuming Might threshold; RIFT-359)"
);

test.todo(
  "unl-159-219 Soul Harvest: exclude Pending chain items from the target choice and revalidate the battlefield " +
    "location at Resolve (CR 355.3/355.15, 359.3.e.9) — needs the TargetPlan resolve re-check (RIFT-357)"
);

