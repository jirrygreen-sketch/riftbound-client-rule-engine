import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/durand-memorial.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-97d6652832570169cee7f8ada60deed43c5e7d3c133950eed2de4fe1f0818f76";
const [trigger] = program.abilities;

test("durand-memorial: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you defend here, choose a unit you control here. Give it [Tank] this combat. (It must be assigned combat damage first.)"
  );
});

test("durand-memorial: judgeReason names the continuous keyword grant and the damage assignment gap", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /815\.1\.c/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /defense-declared/);
});

test("durand-memorial: defense-declared trigger at this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "defense-declared");
  assert.equal(trigger.trigger.filter.event, "defense-declared");
  assert.equal(trigger.trigger.filter.here, true);
  // "you defend" — the merged PlayerSelector spelling for the ability
  // controller is "self".
  assert.equal(trigger.trigger.filter.player, "self");
  assert.equal(trigger.optional, false);
});

test("durand-memorial: the chosen unit is a target, not a pick", () => {
  // 355.5 / 355.7 / 355.10: "choose a unit you control here" is made during
  // Finalize and is not a cost, trigger condition or replacement effect, so it
  // is Targeted. Using a pick would silently skip became-target triggers.
  assert.equal(trigger.body.length, 1);
  const [instruction] = trigger.body;
  assert.equal(instruction.id, "durand-memorial.grant-tank");
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "durand-memorial.chosen-unit");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.deepEqual(target.filter, { type: "unit", controller: "self", here: true });
});

test("durand-memorial: the grant declares the continuous.grant-keyword shape with a combat duration", () => {
  const [instruction] = trigger.body;
  // 815.1.b / 815.2 / 815.3: the ability-layer keyword grant, never a Buff
  // counter or a static Might change.
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Tank" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-combat" });
});

test("durand-memorial: the body declares exactly one continuous keyword grant", () => {
  const ops = program.abilities
    .flatMap((ability) => (ability.kind === "triggered" ? ability.body : []))
    .map((instruction) => instruction.op);
  assert.deepEqual(ops, ["continuous.grant-keyword"]);
});

test("durand-memorial: the [Tank] grant really registers through the merged interpreter and layers", () => {
  // 815.1.b: Tank is a passive combat-damage assignment requirement; 817-line
  // duration semantics come from the continuous effect, and "this combat" is
  // the end-of-combat expiry. The chosen unit receives the keyword; no other
  // object does, and nothing is written as a Buff counter.
  const [instruction] = trigger.body;
  const kernel = world()
    .unit("defender", { might: 3 })
    .unit("bystander", { might: 3 })
    .build();
  kernel.setTargets("durand-memorial.chosen-unit", [kernel.ref("defender")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("defender") });

  const outcome = runAbilityBody([{ ...instruction, targets: undefined }], scoped);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-combat" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Tank");
  assert.equal(registration.effect.filter.objectId, "defender");

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.deepEqual(engine.evaluate(kernel.ref("defender")).keywords.map(keyword => keyword.id), ["Tank"]);
  assert.deepEqual(engine.evaluate(kernel.ref("bystander")).keywords, []);
  assert.equal(engine.evaluate(kernel.ref("defender")).buffs, 0);
  // 815.2: Tank is redundant, so the layer holds a single instance regardless
  // of how many times the same grant is applied.
  engine.expireAt("combat-end", "A");
  assert.deepEqual(engine.evaluate(kernel.ref("defender")).keywords, []);
});

test.todo(
  "durand-memorial: registering the defense-declared trigger from the card program — shared wiring owned by the " +
    "RIFT-257 card-program binding workstream"
);
test.todo(
  "durand-memorial: Tank assignment priority in the Combat Damage step " +
    "(815.1.c.1 / 815.1.c.2; base-combat-allocation.ts binds no assignment-priority requirement)"
);
test.todo(
  "durand-memorial: an emitted defense-declared timing point plus the here-scoped target filter " +
    "(323.2 / 383.4.f / 466.2.c; combat/flow.ts still throws combat-start-transaction for the role designation)"
);
