import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/udyr-wildman.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fa80adfa87e517c318ff696460904b28aeb38024b68666372f0109ecf2757882";

const ability = program.abilities[0];
const chooseInstruction = ability.body[0];
const modes = chooseInstruction.args.modes.value;
const modeById = new Map(modes.map(mode => [mode.id, mode]));

/**
 * A source-bound world with an exhausted Udyr and a unit at a battlefield.
 * The reference kernel compares the `location` filter value literally, so the
 * unit's location is the same `{ type: "battlefield" }` shape the card filters
 * on (a concrete battlefield id would not match).
 */
function udyrWorld() {
  const kernel = world()
    .unit("udyr", { exhausted: true, might: 6, location: { type: "battlefield" } })
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield" } })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("udyr") });
}

test("ogn-157-298 Udyr, Wildman: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // sourceText keeps the catalog text byte for byte, including the missing
  // separator between the printed modes (reported as a data issue, not edited).
  assert.equal(
    program.sourceText,
    "Spend my buff: Choose one you've not chosen this turn —\n" +
      "Deal 2 to a unit at a battlefield.Stun a unit at a battlefield.Ready me.Give me [Ganking] this turn."
  );
  assert.equal(program.sourceText.includes("battlefield.Stun"), true);
});

test("ogn-157-298 Udyr, Wildman: judgeReason cites the per-turn choice memory and the movement consumer", () => {
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /choice-plan adapter/);
  assert.match(program.judgeReason, /Ganking/);
});

test("ogn-157-298 Udyr, Wildman: 'Spend my buff:' is the activated cost and action timing (377.1 / 381.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    payments: [
      {
        kind: "spend-buff",
        object: "self",
        amount: { kind: "constant", value: 1 }
      }
    ]
  });
  assert.equal(ability.restriction, undefined);
});

test("ogn-157-298 Udyr, Wildman: one shared mode choice with the four printed modes in order", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(chooseInstruction.id, "udyr.choose-mode");
  assert.equal(chooseInstruction.op, "choice.mode");
  assert.deepEqual(chooseInstruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseInstruction.args.different, { kind: "constant", value: true });
  assert.equal(chooseInstruction.args.modes.kind, "constant");

  assert.deepEqual(modes.map(mode => mode.id), [
    "udyr.damage-mode",
    "udyr.stun-mode",
    "udyr.ready-mode",
    "udyr.ganking-mode"
  ]);

  const damage = modeById.get("udyr.damage-mode").body[0];
  assert.equal(damage.op, "effect.damage");
  assert.deepEqual(damage.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(damage.targets[0], {
    id: "udyr.damage-target",
    filter: { type: "unit", location: { type: "battlefield" } },
    min: 1,
    max: 1,
    selection: "one"
  });

  const stun = modeById.get("udyr.stun-mode").body[0];
  assert.equal(stun.op, "effect.stun");
  assert.deepEqual(stun.targets[0].filter, { type: "unit", location: { type: "battlefield" } });

  const readyMode = modeById.get("udyr.ready-mode").body[0];
  assert.equal(readyMode.op, "effect.ready");
  assert.deepEqual(readyMode.args, { objects: { kind: "constant", value: { kind: "source" } } });

  const grant = modeById.get("udyr.ganking-mode").body[0];
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args, {
    keyword: { kind: "constant", value: "Ganking" },
    duration: { kind: "constant", value: "end-of-turn" },
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("ogn-157-298 Udyr, Wildman: the stun mode executes through the interpreter and reference kernel (424)", () => {
  const kernel = udyrWorld();
  kernel.setAnswers({ "udyr.choose-mode/mode%3A0": "udyr.stun-mode" });
  kernel.setTargets("udyr.stun-target", [kernel.ref("enemy")]);

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["udyr.stun-unit", "executed"],
    ["udyr.choose-mode", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
});

test("ogn-157-298 Udyr, Wildman: the damage mode's instruction deals exactly 2 to the locked unit (418.1)", () => {
  // effect.damage validates its own Expr arguments (the interpreter pre-evaluates
  // them), so this branch is executed at the primitive level with the card's own
  // args — the same split the merged Singularity/Wages of Pain goldens use.
  const kernel = udyrWorld();
  const damageInstruction = modeById.get("udyr.damage-mode").body[0];

  const run = runInstruction(
    damage,
    {
      amount: damageInstruction.args.amount,
      target: damageInstruction.targets[0].id
    },
    { world: kernel, targets: { [damageInstruction.targets[0].id]: [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("ogn-157-298 Udyr, Wildman: the ready mode readies the exhausted source (416.1)", () => {
  const kernel = udyrWorld();
  kernel.setAnswers({ "udyr.choose-mode/mode%3A0": "udyr.ready-mode" });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("udyr").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("ogn-157-298 Udyr, Wildman golden: the Ganking grant registers the end-of-turn keyword (801.3.a)", () => {
  // "Give me [Ganking] this turn": the merged continuous.grant-keyword
  // primitive registers one ability-layer effect through ctx.addContinuous
  // with the end-of-turn duration; the layer engine derives the keyword.
  const grant = modeById.get("udyr.ganking-mode").body[0];
  const kernel = udyrWorld();
  const outcome = resolveChainBody([grant], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["udyr.grant-ganking", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.results[0].result.linkedValues.granted, {
    count: 1,
    objects: [kernel.ref("udyr")]
  });

  const engine = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.deepEqual(engine.evaluate(kernel.ref("udyr")).keywords.map(entry => entry.id), ["Ganking"]);
  // 317.1.a: the grant expires with the turn.
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.deepEqual(engine.evaluate(kernel.ref("udyr")).keywords, []);
});

test("ogn-157-298 Udyr, Wildman golden: 'Spend my buff:' is charged through the merged cost plan (702.2.b)", () => {
  const kernel = udyrWorld();
  kernel.addPlayer("A", {});
  const buffed = kernel.clone({ sourceSnapshot: kernel.getObject("udyr") });
  // The reference kernel supports buff counters on the source object.
  buffed.perform({ type: "buff", object: buffed.ref("udyr"), amount: 1 });
  const plan = buildCostPlan(buffed, { id: "cost:udyr", cost: ability.cost });
  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["spend-buff"]);
  const receipt = payCostPlan(buffed, plan);
  assert.equal(receipt.paid, true);
  assert.equal(buffed.getObject("udyr").buffs, 0);
});

test.todo(
  "ogn-157-298 Udyr, Wildman: 'Choose one you've not chosen this turn' needs per-turn choice memory; " +
    "choice.mode's different flag only de-duplicates within one resolution (CR v1.5 383.1.b / 355.5.a)."
);
