import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/udyr-wildman.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
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

test("ogn-157-298 Udyr, Wildman: judgeReason cites the per-turn choice memory and the keyword grant", () => {
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /continuous\.movement/);
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

test("ogn-157-298 Udyr, Wildman: the Ganking grant op has no registered primitive yet", () => {
  const grant = modeById.get("udyr.ganking-mode").body[0];
  assert.equal(instructionDefinitionsById.has(grant.op), false);
  // Every other op the card uses is registered and therefore executable; the
  // grant op is the only unmerged one (choice.mode is an interpreter control
  // node, not a registry entry).
  assert.equal(instructionDefinitionsById.has("effect.damage"), true);
  assert.equal(instructionDefinitionsById.has("effect.stun"), true);
  assert.equal(instructionDefinitionsById.has("effect.ready"), true);
});

test.todo(
  "ogn-157-298 Udyr, Wildman: 'Choose one you've not chosen this turn' needs per-turn choice memory; " +
    "choice.mode's different flag only de-duplicates within one resolution (CR v1.5 383.1.b / 355.5.a)."
);
test.todo(
  "ogn-157-298 Udyr, Wildman: 'Give me [Ganking] this turn' needs an end-of-turn continuous.grant-keyword " +
    "effect and a consumer for Ganking's continuous.movement permission (CR v1.5 801.3.a / 810; " +
    "RIFT-91 layers workstream, zones/movement)."
);
