import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/supernova.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-0e5a4bfb603171bb0504c082d28e606b5fb0050252aed40f969d0c88f58839b4";
const TARGET_ID = "supernova.target-unit";

const play = program.abilities[0];
const [damageInstruction, drawInstruction] = play.body;

test("rad-059-167 Supernova: program validates and is judge-required on the catalog card type", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judge reason must name the concrete disagreement, not a bare "not implemented".
  assert.match(program.judgeReason, /Spell/);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /effect\.draw/);
});

test("rad-059-167 Supernova: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(program.sourceText, "Deal 10 to a unit. Draw 2.");
});

test("rad-059-167 Supernova: one play ability with printed cost 9 energy / 1 power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 9 },
    power: { kind: "constant", value: 1 }
  });
});

test("rad-059-167 Supernova: 'Deal 10 to a unit' is one targeted effect.damage instruction", () => {
  assert.equal(damageInstruction.id, "supernova.deal-10");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 10 });
  assert.deepEqual(damageInstruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.picks, undefined);
  assert.equal(damageInstruction.targets.length, 1);
  const [spec] = damageInstruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.deepEqual(spec.filter, { type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-059-167 Supernova: 'Draw 2' is an independent effect.draw instruction (359.3.e.11)", () => {
  assert.equal(drawInstruction.id, "supernova.draw-2");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  // Not linked to the damage instruction: a negated damage action must not suppress the draw.
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("rad-059-167 Supernova: effect.damage deals 10 to the locked unit through the reference kernel", () => {
  const kernel = world()
    .unit("supernova", { zone: "chain" })
    .unit("enemy-unit", { owner: "B", might: 3 })
    .build();
  const target = kernel.ref("enemy-unit");
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 10 }, target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [target] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 10);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-unit").damage, 10);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("rad-059-167 Supernova: a stale target makes the damage instruction ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("supernova", { zone: "chain" })
    .unit("fleeing-unit", { owner: "B", might: 3 })
    .build();
  const stale = kernel.ref("fleeing-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 10 }, target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("fleeing-unit").zone, "hand");
  assert.equal(kernel.getObject("fleeing-unit").damage, 0);
});

test("rad-059-167 Supernova: effect.draw draws exactly 2 for the controller (414.3)", () => {
  const kernel = world().unit("supernova", { zone: "chain" }).deck(["c1", "c2", "c3"]).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: 2 } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "rad-059-167 Supernova: full chain play (printed cost payment, Action timing, resolution order) " +
    "— depends on the coordinator's chain/cost integration; " +
    "also blocked on the catalog cardType fix (Spell vs Unit) so this text is either a play " +
    "ability (420.1) or a play effect (383.4.a) — card-data task, not this workstream"
);
