import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/square-up.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-e4dc01dd2f105796f021b575a0dcf055c0b996025247706f3605affedf193ce6";
const SOURCE_TEXT =
  "[Repeat] — Discard 1 (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit [Assault 4] this turn. (+4 :rb_might: while it's an attacker.)";

const [repeatKeyword, play] = program.abilities;
const [grantAssault] = play.body;

test("unl-017-219 Square Up: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-017-219 Square Up: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("unl-017-219 Square Up: [Repeat] declared plus a duration-bounded Assault 4 grant to one unit", () => {
  assert.deepEqual(repeatKeyword, { kind: "keyword", keyword: "repeat" });
  assert.equal(repeatKeyword.value, undefined);
  // The printed Discard 1 is the Repeat cost; it is not folded into the base cost, and no
  // fixed-count repeat instruction stands in for the unmerged payment hook.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["square-up.grant-assault-4", "continuous.grant-keyword"]
  ]);

  // 807.1.c / 317.2.c: Assault 4 for the turn; the grant is a real ability-layer
  // registration, while its attacker designation consumer remains pending.
  assert.deepEqual(grantAssault.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grantAssault.args.value, { kind: "constant", value: 4 });
  assert.deepEqual(grantAssault.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantAssault.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "square-up.unit" }
  });
  assert.equal(grantAssault.linkedTo, undefined);
  assert.equal(grantAssault.picks, undefined);
  // "a unit" (not "your unit"): the target has no controller restriction (355.9.a.1).
  assert.deepEqual(grantAssault.targets, [
    {
      id: "square-up.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-017-219 Square Up golden: the printed target receives Assault 4 through the merged grant primitive", () => {
  const kernel = world().unit("target", { owner: "A", controller: "A", might: 3 }).build();
  const target = kernel.ref("target");
  const run = runInstruction(
    grantKeyword,
    grantAssault.args,
    { world: kernel, targets: { "square-up.unit": [target] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.granted, { count: 1, objects: [target] });
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(kernel.continuousEffects[0].effect.effect.keyword, "Assault");
  assert.equal(kernel.continuousEffects[0].effect.effect.keywordValue, 4);
  assert.equal(kernel.continuousEffects[0].effect.filter.objectId, "target");

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.snapshot(target).keywords, [{ id: "Assault", value: 4 }]);
  layers.advance({ id: "turn-end" });
  assert.deepEqual(layers.snapshot(target).keywords, []);
});

test.todo(
  "unl-017-219 Square Up: the granted Assault expands to +4 Might while the unit is an attacker " +
    "(807.1.c / 807.1.d.1) — the current condition evaluator does not consume combatRole/designation " +
    "(RIFT-359)"
);
test.todo(
  "unl-017-219 Square Up: paying Repeat's printed Discard 1 cost executes the spell's effect one additional time " +
    "(820.1.d.1 / 820.2.a / 820.3.a) — the Finalize consumer still needs the repeat.cost payment and paid-instance count"
);

