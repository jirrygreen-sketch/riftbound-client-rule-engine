import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rell-magnetic.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-27bea0f367ed3fcfb05e2db8a75852c62b0d458ec5b40b46249818322961e541";

test("sfd-024-221 Rell, Magnetic: validates identity and ability structure", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /effects\/keywords\/Tank\.ts/);
  assert.match(program.judgeReason, /energyLte/);
  assert.equal(program.sourceText, "[Tank] (I must be assigned combat damage first.)\nWhen I attack, you may play an Equipment with Energy cost no more than :rb_energy_2:, ignoring its cost, and attach it to me.");
});

test("sfd-024-221 Rell, Magnetic: Tank plus optional attack play", () => {
  const [tank, attack] = program.abilities;
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(attack.trigger.at, "attack-declared");
  const optional = attack.body[0];
  assert.equal(optional.op, "choice.optional");
  const play = optional.args.body.value[0];
  assert.equal(play.op, "effect.play");
  assert.deepEqual(play.args.pick, { kind: "constant", value: "rell-magnetic.equipment" });
  assert.deepEqual(play.args.cost, { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } });
  assert.deepEqual(play.picks[0].filter, { type: "gear", tag: "Equipment", zone: "hand", controller: "controller", energyLte: 2 });
  assert.equal(play.picks[0].min, 1);
  assert.equal(play.picks[0].max, 1);
});

test.todo("Rell: add Tank combat assignment, printed-cost filtering, ignored-cost planning and played-object attachment (RIFT-89/RIFT-91)");
