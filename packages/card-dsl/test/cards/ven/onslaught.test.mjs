// Template evidence: ../templates/keyword-play-continuous-might-653.test.mjs.
// Whole-card scenarios remain blocked by Flow; existing body goldens remain valid.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/onslaught.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Card bodies and filters run through the chain's own interpreter adapter — the
// production entry point that re-wraps Expr arguments for the registered
// primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-3d956150539f05acad046c9b3b303490605a2e9f9546aa9bc58fb0b8256412a9";
const SOURCE_TEXT =
  "Give a unit +6 :rb_might: this turn.\n" +
  "[Flow] :rb_energy_4: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [givePlusSix] = play.body;
const [unitSpec] = givePlusSix.targets;

test("ven-081-166 Onslaught: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-081-166 Onslaught: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-081-166 Onslaught: judgeReason names the remaining Flow cost and chain-exit gaps", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /replacement/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-081-166 Onslaught: [Flow] keyword plus one +6 Might instruction on one Board unit", () => {
  assert.equal(program.abilities.length, 2);
  // 829.1.a: Flow is present on Spells and is a passive keyword; the card only
  // declares the keyword identity (README section 5).
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });

  assert.equal(play.kind, "play");
  // Printed base cost 4 Energy; the catalog's power is null (no printed Power),
  // which is never rewritten as 0 (README section 2).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["onslaught.give-plus-6", "continuous.might"]
  ]);

  // 143.2.a / 317.2.c: a temporary Might change with a this-turn duration; the
  // registered continuous.might instruction creates the arithmetic-layer effect.
  assert.deepEqual(givePlusSix.args, {
    amount: { kind: "constant", value: 6 },
    duration: { kind: "constant", value: "this-turn" },
    objects: { kind: "constant", value: { kind: "target", id: "onslaught.unit" } }
  });
  assert.equal(givePlusSix.linkedTo, undefined);
  assert.equal(givePlusSix.condition, undefined);

  // 355.7 / 355.9.a.1 / 355.9.b: "a unit" is one chosen Board unit and no
  // controller restriction is printed.
  assert.deepEqual(unitSpec, {
    id: "onslaught.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(givePlusSix.picks, undefined);
});

test("ven-081-166 Onslaught: the declared unit filter really selects Board units", () => {
  // Exercise the declared filter through the interpreter query path as well as
  // the targeted continuous effect below.
  const kernel = world()
    .unit("board-unit", { owner: "A", controller: "A", might: 4 })
    .card("spell-in-trash", { owner: "A", zone: "trash", types: ["spell"] })
    .build();
  const outcome = resolveChainBody(
    [
      {
        id: "onslaught.probe",
        op: "condition.value",
        args: {
          value: { kind: "count", subject: "unit", filter: unitSpec.filter }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  // Only the Board unit matches: the Trash card is not on the Board.
  assert.equal(outcome.linkedValues["onslaught.probe.value"], 1);
});

test("ven-081-166 Onslaught golden: the original body gives the chosen enemy unit +6 Might until turn end", () => {
  const kernel = world().unit("ally", { might: 3 }).unit("enemy", { owner: "B", might: 4 }).build();
  kernel.setTargets(unitSpec.id, [kernel.ref("enemy")]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["onslaught.give-plus-6.affected.objects"], [kernel.ref("enemy")]);
  assert.equal(kernel.continuousEffects.length, 1);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 10);
  assert.equal(layers.evaluate(kernel.ref("enemy")).buffs, 0);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 3);
  assert.deepEqual(layers.advance({ id: "combat-end" }), []);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 10);
  assert.equal(layers.advance({ id: "turn-end" }).length, 1);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 4);
});

test("ven-081-166 Onslaught golden: a target that left the board receives no continuous effect", () => {
  const kernel = world().unit("target", { might: 4 }).build();
  const stale = kernel.ref("target");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(unitSpec.id, [stale]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(kernel.continuousEffects, []);
});

test.todo(
  "ven-081-166 Onslaught: select and record the separate Flow instance with its printed 4 Energy cost " +
    "via params.cost, permit the Trash play, and consume the leave-chain banish replacement " +
    "(829.1.b / 829.1.b.1 / 829.1.c.3)"
);
