import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const cardId = "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c";
const program = cardProgramsById.get(cardId);

test("rumble-scrapper program is registered and validates", () => {
  assert.ok(program, "rumble-scrapper must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rumble-scrapper identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, cardId);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Your Mechs have +1 :rb_might: (including me).\n" +
      "When I hold, play a 3 :rb_might: Mech unit token to your base."
  );
});

test("rumble-scrapper structure: static might aura + hold trigger token body", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("continuous.might"), "judgeReason must cite the Might layer path");
  assert.ok(program.judgeReason.includes("ProgramStaticBinder"), "judgeReason must cite the missing registration consumer");
  assert.ok(program.judgeReason.includes("selectorMatches"), "judgeReason must cite the relative-controller filter gap");
  assert.ok(program.judgeReason.includes("pipeline-match"), "judgeReason must cite the hold-event identity gap");
  assert.equal(program.abilities.length, 2);

  const [aura, hold] = program.abilities;
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  // The card keeps the card-program filter vocabulary (the merged siblings
  // rumble-hotheaded / mechanized-menace use the same `tag` spelling); the
  // layer engine itself reads `tags`, and no static registration path
  // translates the card spelling yet.
  assert.equal(aura.effect.filter.tag, "Mech");
  assert.equal(aura.effect.filter.controller, "controller");
  assert.equal(aura.effect.value.value, 1);

  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  assert.equal(hold.trigger.filter.event, "hold");
  assert.equal(hold.trigger.filter.filter.source, "self");
  assert.equal(hold.optional, false);
  assert.equal(hold.body.length, 1);
  const [instruction] = hold.body;
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  // 440.2.c / 185.2.a: a *played* token is created on the Chain and the play
  // action takes it over; "your base" is the ability controller's base, which
  // the merged evidence.test spells as the ability-relative "you".
  assert.equal(instruction.args.mode.value, "play");
  assert.deepEqual(instruction.args.location.value, { type: "base", player: "you" });
});

test("rumble-scrapper golden: the merged continuous.might primitive registers the +1 aura layer entry", () => {
  // RIFT-258 merged continuous.might, so the aura half really executes once a
  // caller registers it. The evidence pins the registered amount and the
  // arithmetic layer, and shows why the filter spelling matters: the layer
  // engine's relative-player selector never resolves to the ability
  // controller, so the card's `controller` field matches nothing today.
  const kernel = world()
    .unit("scrapper", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 4 })
    .build();
  const [aura] = program.abilities;
  const run = runInstruction(
    might,
    { filter: { tags: ["Mech"], zone: "board" }, amount: aura.effect.value.value },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 1);
    assert.deepEqual(entry.duration, { type: "permanent" });
  }

  // The printed clause says "Your Mechs", so the aura's controller anchor must
  // be the ability controller. The merged layer filter's selectorMatches
  // treats both "self" and "opponent" relative to the evaluated object itself,
  // which is why the card keeps judge-required.
  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("scrapper")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("enemy-mech")).might, 5);
});
