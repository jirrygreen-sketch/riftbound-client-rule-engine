import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/hold-em.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-6241ef3881abbc30d79cdaf37ca912ade70c601045279aed082fc727f4ace85c";
const [action, discount, play] = program.abilities;
const [mightInstruction] = play.body;

test("rad-070-167 Hold 'Em: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "This costs :rb_energy_2: less if you've played a unit or gear to a battlefield this turn.\n" +
      "Give a unit +3 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-070-167 Hold 'Em: judgeReason names the temporary Might gap and the history-query gap", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /objectFilter/);
  assert.match(program.judgeReason, /RIFT-89\/90/);
});

test("rad-070-167 Hold 'Em: structure — Action keyword and the printed energy-3 cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  // power: null means no printed power; the field is absent, not 0.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("rad-070-167 Hold 'Em: structure — the energy-2 discount gated on this turn's battlefield plays", () => {
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.resource, "energy");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(discount.effect.minimum, { kind: "constant", value: 0 });
  assert.equal(discount.effect.appliesTo, "self");

  // The gate is a turn-scoped event history over plays of a unit or gear to a
  // battlefield. It is authored as descriptive constant data because
  // HistoryQuery cannot carry the object filter or the play destination yet
  // (judgeReason) — no merged condition silently approximates it.
  assert.equal(discount.condition.kind, "expression");
  const gate = discount.condition.value;
  assert.equal(gate.kind, "constant");
  assert.deepEqual(gate.value, {
    history: "cards-you-played-this-turn",
    scope: "turn",
    action: "play",
    player: "controller",
    objectTypes: ["unit", "gear"],
    to: "battlefield"
  });
});

test("rad-070-167 Hold 'Em: structure — one temporary +3 Might instruction targeting one unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "hold-em.give-plus-3-might");
  // Temporary Might is a layers effect, never a Buff counter (702).
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.picks, undefined);

  assert.equal(mightInstruction.targets.length, 1);
  const [target] = mightInstruction.targets;
  assert.equal(target.id, "unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test.todo(
  "rad-070-167 Hold 'Em: 'Give a unit +3 Might this turn' needs the continuous.might layers consumer " +
    "with an end-of-turn duration — RIFT-91."
);

test.todo(
  "rad-070-167 Hold 'Em: 'This costs 2 Energy less if you've played a unit or gear to a battlefield " +
    "this turn' needs an event history query carrying an object filter (unit or gear) and the play " +
    "destination; HistoryQuery has scope/action/timingPoint/player/object and the interpreter rejects " +
    "unknown fields — RIFT-89/90 (condition.history)."
);

test.todo(
  "rad-070-167 Hold 'Em: applying the discount to the finalized cost plan (and proving it never reduces " +
    "below its minimum) needs the cost-plan wiring for static self cost modifications — RIFT-89."
);
