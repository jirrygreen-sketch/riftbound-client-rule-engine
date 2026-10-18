// Execution evidence: ../templates/keyword-play-continuous-might-683.test.mjs
// (RIFT-683). That suite's rows run this program's original abilities, printed
// base cost, Board-unit target and continuous.might body through the real card
// scenario harness (including the turn-end expiry and ignored-target boundary);
// its measured-gate test expands the [Flow] keyword through the production
// binder and asserts the real rejection of flow.cost and of the leave-chain
// banish. This file keeps the validation, identity, structure and
// primitive-level evidence.
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
import { createEngineStaticBinder, createProgramBinding, expandProgram } from "../../../../engine-core/dist/programs/index.js";
import { planInstruction } from "../../../../engine-core/dist/replacement/planner.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /flow\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /effect\.banish/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /describePlay/);
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
  "ven-081-166 Onslaught: play the spell from Trash for its printed 4 Energy flow cost and banish it " +
    "when it leaves the chain (829.1.b/829.1.b.1/829.1.c.1); measured in " +
    "keyword-play-continuous-might-683.test.mjs."
);

test("ven-081-166 Onslaught evidence: the merged Flow expansion still cannot bind, banish, or play from Trash", () => {
  // Re-measured 2026-10-18 across the three recorded Flow gaps.
  const source = world()
    .object("onslaught", { cardId: CARD_ID, types: ["spell"], zone: "hand", energy: 4, power: null, might: null })
    .build()
    .getObject("onslaught");
  const expanded = expandProgram(program, source).expanded;
  const flowCost = expanded.find((ability) => ability.kind === "static" && ability.effect.kind === "flow.cost");
  assert.ok(flowCost, "the merged Flow KeywordDef expands to a static flow.cost");
  assert.throws(
    () => createEngineStaticBinder(fixture({ cards: [] }).engine).bindStatic(flowCost, source),
    error => error.constructor.name === "ProgramBindingError" &&
      /Static ability kind flow\.cost has no layer mapping/.test(error.message)
  );

  const replacement = expanded.find((ability) => ability.kind === "replacement");
  assert.deepEqual(replacement.with.map((instruction) => instruction.op), ["effect.banish"]);
  assert.throws(
    () => planInstruction(replacement.with[0], {
      hostRef: source.ref,
      sourceZone: "chain",
      replacedObject: source.ref,
      controller: "A"
    }, { host: {}, controller: "A", evaluate: (expr) => expr?.value }),
    error => error.constructor.name === "BlockedReplacementError" &&
      /Unsupported replacement opcode: effect\.banish/.test(error.message)
  );

  // The printed 4 Energy never reaches the Flow expansion, and the production
  // play path refuses the card, so no trash play or leave-chain banish exists.
  assert.equal(program.abilities[0].value, undefined);
  assert.throws(
    () => createProgramBinding({ cardPrograms: [program] }).describePlay({ type: "play", object: source.ref, player: "A" }, source),
    error => error.code === "judge-required" && /Flow 消费链/.test(error.message)
  );
});
