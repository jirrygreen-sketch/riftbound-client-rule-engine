import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/supernova.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

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
  assert.match(program.judgeReason, /describePlay/);
  // The refreshed reason records the measured consequence of the card-type
  // disagreement: describePlay derives the chain kind from source.types.
  assert.match(program.judgeReason, /source\.types/);
  assert.match(program.judgeReason, /spell \/ unit \/ gear/);
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

test("rad-059-167 Supernova: the production play binding and chain really resolve the spell", () => {
  // programs/play.ts's describePlay turns this program into a real chain draft
  // (printed 9 Energy / 1 Order), and chain/engine.ts's Finalize/Resolve pays it,
  // deals 10 to the locked target, draws 2, and moves the spell to Trash. The
  // only remaining blocker is the catalog cardType (Unit vs printed Spell).
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const kernel = world().player("A", { energy: 20, power: ["Order"] }).player("B")
    .unit("supernova", {
      owner: "A", types: ["spell"], zone: "hand", cardId: CARD_ID,
      energy: 9, power: ["Order"], might: null
    })
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .deck(["a", "b", "c"], { owner: "A" })
    .build();
  const decide = request => request.type === "select-objects"
    ? request.options.filter(ref => ref.id === "enemy")
    : request.type === "optional" ? true : (() => { throw new Error("Unexpected choice: " + request.id); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false, describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error?.message ?? String(error)));
  const source = kernel.getObject("supernova");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.kind, "spell");
  assert.deepEqual(draft.cost.cost, {
    kind: "explicit",
    energy: { kind: "constant", value: 9 },
    power: { kind: "constant", value: 1 }
  });
  engine.execute({ id: "play:supernova", controller: "A", source, kind: "spell", speed: "normal", body: draft.body });
  engine.advance();
  let guard = 0;
  while (engine.items.length && guard++ < 20) engine.pass(engine.priority);
  assert.deepEqual(errors, []);
  assert.equal(kernel.getObject("supernova").zone, "trash", "the resolved spell leaves the chain");
  assert.equal(kernel.getObject("enemy").damage, 10, "Deal 10 went to the locked unit");
  assert.equal(kernel.player("A").energy, 11, "the printed 9 Energy was paid");
  assert.deepEqual(kernel.player("A").power, ["Order"], "the printed 1 Order Power stayed (reference kernel pays no Power)");
  assert.equal(kernel.player("A").handSize, 2, "Draw 2 resolved");
});

test.todo(
  "rad-059-167 Supernova: full chain play now really resolves through describePlay + ChainEngine " +
    "(printed cost, damage, draw, spell to Trash); the remaining blocker is the catalog cardType fix " +
    "(Spell vs Unit) so this text is either a play " +
    "ability (420.1) or a play effect (383.4.a) — card-data task, not this workstream"
);

test("rad-059-167 Supernova gap: describePlay derives the chain kind from source.types, so the catalog type decides the card", () => {
  // 420.1 vs 383.4.a: the same authored program produces a spell, unit, or gear
  // chain item purely from the source snapshot's types. That is why the
  // catalog's Spell/Unit disagreement is a real blocker rather than a cosmetic
  // labelling problem.
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const kinds = ["spell", "unit", "gear"].map(type => {
    const kernel = world()
      .unit("card", { types: [type], zone: "hand", cardId: CARD_ID, energy: 9, power: ["Order"], might: null })
      .build();
    const source = kernel.getObject("card");
    const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
    return [draft.kind, draft.body.map(instruction => instruction.op)];
  });
  assert.deepEqual(kinds, [
    ["spell", ["effect.damage", "effect.draw"]],
    ["unit", ["effect.damage", "effect.draw"]],
    ["gear", ["effect.damage", "effect.draw"]]
  ]);
});
