import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/demon-shade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL = "card.hash-c4b9b8b1ea96f69164e5303d652fe97e69e6f81ce7b8f455b1a108203dd67a45";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Choose a friendly unit, then choose one —\n" +
  "Move it to an open battlefield.Give it [Ganking] this turn if there are no open battlefields. " +
  "(It can move from battlefield to battlefield.)";

const [keyword, play] = program.abilities;
const [mode] = play.body;
const [moveBranch, grantBranch] = mode.args.modes.value;
const [moveInstruction] = moveBranch.body;
const [grantInstruction] = grantBranch.body;

test("Demon Shade program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Demon Shade identity, ruleset, status and printed text (byte-for-byte)", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /170\.11\.c/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-359/);
  // RIFT-357 is named as the landed contract that the destination is authored
  // against; the real gap is the missing candidate source.
  assert.match(program.judgeReason, /Location choice has no options/);
  assert.doesNotMatch(program.judgeReason, /依赖 RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(90|91|120|257)/);
  // The catalog text glues "battlefield.Give" together; sourceText keeps it.
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.sourceText.includes("battlefield.Give"), true);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Demon Shade structure: [Hidden], printed cost, and the two exclusive modes", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["demon-shade-move", "demon-shade-grant"]
  );
  // "choose one —" (355.3): exactly one mode executes; no linkedTo chain.
  assert.equal(mode.linkedTo, undefined);
  assert.equal(moveBranch.body.length, 1);
  assert.equal(grantBranch.body.length, 1);

  // Move it to an open battlefield (170.11.c): targeted friendly unit and the
  // merged runtime Location selector with the open predicate.
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "demon-shade.moved-unit" }
  });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "location",
    value: {
      kind: "choose",
      id: "demon-shade.open-battlefield",
      filter: { type: "battlefield", occupied: false, controlled: false }
    }
  });
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "demon-shade.moved-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // Give it [Ganking] this turn: end-of-turn keyword grant with a friendly target.
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // The merged primitive's symbolic selector form (contract 3.6).
  assert.deepEqual(grantInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "demon-shade.granted-unit" }
  });
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "demon-shade.granted-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("Demon Shade: only unoccupied Battlefields become destination candidates", () => {
  // 170.11.c: "open" means the Battlefield is unoccupied and uncontrolled. A
  // Battlefield inferred only from an occupant is excluded; when the state has
  // no open Battlefield, the effect ignores the Move instead of guessing.
  const occupied = world()
    .player("A").player("B")
    .unit("mover", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("occupant", { owner: "B", location: { type: "battlefield", id: "bf-occupied" } })
    .build();
  const scoped = occupied.clone({ sourceSnapshot: occupied.getObject("mover") });
  scoped.setTargets("demon-shade.moved-unit", [occupied.ref("mover")]);

  const occupiedOutcome = resolveChainBody([{ ...moveInstruction, targets: undefined }], scoped);
  assert.equal(occupiedOutcome.status, "partial");
  assert.deepEqual(occupiedOutcome.results.map(entry => [entry.id, entry.result.status]), [["demon-shade.move-unit", "ignored"]]);
  assert.deepEqual(scoped.getObject("mover").location, { type: "base", player: "A" });

  // Without an unoccupied Battlefield among the known locations the merged
  // candidate source yields nothing: the interpreter never guesses a location.
  const noFields = world()
    .unit("mover", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .build();
  const scopedNoFields = noFields.clone({ sourceSnapshot: noFields.getObject("mover") });
  scopedNoFields.setTargets("demon-shade.moved-unit", [noFields.ref("mover")]);
  const emptyOutcome = resolveChainBody([{ ...moveInstruction, targets: undefined }], scopedNoFields);
  assert.equal(emptyOutcome.status, "partial");
  assert.deepEqual(emptyOutcome.results.map(entry => [entry.id, entry.result.status]), [["demon-shade.move-unit", "ignored"]]);
});

test.todo(
  "Demon Shade: 'Give it [Ganking] this turn' needs the end-of-turn continuous.grant-keyword effect (CR 810, " +
    "contract 3.4) — the primitive is merged (RIFT-258); what is missing is the 810.1.c movement-permission" +
    " consumer"
);

test.todo(
  "Demon Shade: 'if there are no open battlefields' needs an empty-collection predicate for the open-battlefield " +
    "set (no compare operator covers set emptiness) — RIFT-359 condition.predicate"
);

test.todo(
  "Demon Shade: the printed 'Choose a friendly unit, then choose one' Finalize order (355.5 before 355.3) belongs " +
    "to the target and mode selection plan — RIFT-358"
);

test("Demon Shade: the [Ganking] grant really registers an ability-layer keyword for the turn", () => {
  // CR 810.1.b: Ganking is the "can move from battlefield to battlefield"
  // permission. The merged continuous.grant-keyword primitive (RIFT-258) is the
  // producer of the ability-layer registration; its end-of-turn duration is the
  // "this turn" lifetime. The movement consumer is tracked in judgeReason.
  const kernel = world()
    .unit("hero", { might: 2 })
    .unit("friendly", { might: 3 })
    .unit("other", { mayMove: true, might: 3 })
    .build();
  kernel.setTargets("demon-shade.granted-unit", [kernel.ref("friendly")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });

  const outcome = runAbilityBody([{ ...grantInstruction, targets: undefined }], scoped);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.equal(registration.effect.filter.objectId, "friendly");

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.deepEqual(engine.evaluate(kernel.ref("friendly")).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(engine.evaluate(kernel.ref("other")).keywords, []);
  // 317.2.c: the this-turn grant expires at the turn-end timing.
  engine.expireAt("turn-end", "A");
  assert.deepEqual(engine.evaluate(kernel.ref("friendly")).keywords, []);
});

// --- 2026-10-18 re-sweep: measured gaps for the mode choice, the open set and the movement licence ---
test("Demon Shade re-sweep: the production play draft is refused before Finalize because choice.mode has no plan adapter", () => {
  // programs/play.ts validateSurface rejects choice.mode outright, and
  // chain/engine.ts assertFinalizationSurface repeats the block at Finalize. The
  // card therefore never reaches a resolvable chain item, whatever the
  // destination or grant arguments say.
  assert.equal(mode.op, "choice.mode");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const kernel = world()
    .unit("spell", {
      cardId: program.canonicalCardId,
      zone: "chain",
      types: ["spell"],
      controller: "A",
      owner: "A",
      energy: 3,
      power: ["Fury"]
    })
    .build();
  assert.throws(
    () => binding.describePlay({ type: "play", player: "A", object: kernel.ref("spell") }, kernel.getObject("spell")),
    /Mode choices require a Finalize\/Resolve choice-plan adapter/
  );
});

test("Demon Shade re-sweep: the count expression cannot express the 170.11.c open set", () => {
  // RIFT-359 shipped condition predicates, but none of them tests set
  // emptiness. A count query is available, yet its filter goes through
  // matchesObjectFilter, which ignores unknown keys — so open/occupied/
  // controlled all match every object and the count is identical for an
  // occupied and an empty battlefield.
  const kernel = world()
    .player("A")
    .player("B")
    .base("bf-open", { types: ["battlefield"], zone: "board", controller: "A" })
    .base("bf-taken", { types: ["battlefield"], zone: "board", owner: "B", controller: "B" })
    .unit("occupant", { zone: "board", owner: "B", controller: "B", location: { type: "battlefield", id: "bf-taken" } })
    .unit("mover", { zone: "board", controller: "A", location: { type: "base", player: "A" } })
    .build();
  const source = kernel.getObject("mover");
  const environment = {
    context: bindResolveContext(kernel, { source, controller: "A" }),
    host: source.ref,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  const count = filter => evaluateExpression({ kind: "count", subject: "battlefield", filter }, environment);
  assert.equal(count({ type: "battlefield" }), 2);
  // The predicate keys are silently ignored, so every spelling counts the same
  // set — the reason the "no open battlefields" guard cannot be authored.
  assert.equal(count({ type: "battlefield", occupied: false, controlled: false }), 2);
  assert.equal(count({ type: "battlefield", open: true }), 2);
  // A real context only knows the battlefields that some object stands on, so
  // an unoccupied battlefield is absent from the candidate set entirely.
  assert.deepEqual(
    queryLocationCandidates(environment.context, { type: "battlefield", occupied: false, controlled: false }),
    []
  );
});

test("Demon Shade re-sweep: the merged re-expansion turns the granted Ganking into a real movement permission, but is not the production engine", () => {
  // RIFT-710's KeywordGrantLayerEngine expands the granted Ganking and
  // layers/rules/query movement() then reports the battlefield-to-battlefield
  // route. LayerEngine proper only rewrites the keyword list, and ChainEngine
  // constructs that plain engine.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("hero", { zone: "board", controller: "A", might: 2 })
    .unit("src", { zone: "board", controller: "A" })
    .build();
  kernel.setTargets("demon-shade.granted-unit", [kernel.ref("hero")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  const outcome = runAbilityBody([{ ...grantInstruction, targets: undefined }], scoped);
  assert.equal(outcome.status, "executed");

  const entries = scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));
  const plain = createLayerEngine(scoped.objects, entries);
  assert.deepEqual(plain.evaluate(kernel.ref("hero")).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.equal(movement(new ContinuousEffectRegistry(), kernel.ref("hero"), plain.evaluate(kernel.ref("hero")), "A").canGank, false);

  const context = source => bindResolveContext(scoped, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(scoped.objects, { context });
  for (const entry of scoped.continuousEffects) layers.addContinuous(entry.effect, entry.duration);
  const granted = layers.evaluate(kernel.ref("hero"));
  assert.deepEqual(granted.keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.equal(movement(layers.registry, kernel.ref("hero"), granted, "A").canGank, true);

  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host: createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => kernel.choose(request),
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    }),
    cleanup: () => false
  });
  assert.equal(engine.layers.constructor.name, "LayerEngine");
});
