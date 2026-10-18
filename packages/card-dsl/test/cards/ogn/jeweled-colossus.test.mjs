import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jeweled-colossus.js";

import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722";

test("Jeweled Colossus program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  // 2026-10-17 re-sweep: both halves cite a measured production gap that is
  // still open (designation dispatch and the expanded "object.id" filter key).
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /814\.1\.b\.3/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /expression\.ts|expr\.ts/);
  assert.match(program.judgeReason, /object\.id/);
  assert.match(program.judgeReason, /programs\/filters/);
  assert.match(program.judgeReason, /vision-top/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "[Shield] (+1 :rb_might: while I'm a defender.)"
  );
});

test("Jeweled Colossus declares exactly the two printed keywords, in printed order", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "vision" });
  // Shield is printed without a value, so no `value` is recorded here; the
  // KeywordDef presumes 1 (814.1.b.3).
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "shield" });
  assert.equal(program.abilities[1].value, undefined);
});

test("Jeweled Colossus: the expanded Shield static registers, but its defender condition cannot read designation", () => {
  // 814.1.c/814.1.d.1: +1 Might while the host holds the Defender designation.
  // The KeywordDef's continuous.might binds, but the bundled condition is
  // evaluated by effects/interpreter/condition.ts -> expr.ts, which only reads
  // ObjectSnapshot's own fields and has no `designation` characteristic, so
  // programs/statics.ts swallows the MissingInformation and reports false.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("colossus", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 4, combatRole: "defender" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const source = kernel.getObject("colossus");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const shield = binding.inspect(source).abilities.find(ability => ability.kind === "static" && ability.effect.kind === "continuous.might");
  assert.equal(shield.condition.left.property, "designation");
  assert.deepEqual(shield.condition.right, { kind: "constant", value: "defender" });
  const handle = createEngineStaticBinder(engine).bindStatic(shield, source);
  const registered = engine.layers.registry.list()[0];
  assert.equal(registered.effect.effect.condition(source), false);
  assert.equal(engine.layers.evaluate(source.ref).might, 4);
  handle.unbind();
});

test("Jeweled Colossus: the expanded Vision filter is refused before its inspect body can run", () => {
  // 817.1.c: the engine's own Vision KeywordDef filters the entering object with
  // { objectId: "self", "object.id": "self" }; programs/filters.ts does not allow
  // the "object.id" key, so the production registration step rejects it.
  const kernel = world().unit("colossus", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"] }).build();
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const vision = binding.inspect(kernel.getObject("colossus")).abilities.find(ability => ability.kind === "triggered");
  assert.deepEqual(vision.trigger.filter, { objectId: "self", "object.id": "self" });
  assert.throws(
    () => translateTriggerFilter(vision.trigger.filter, kernel.ref("colossus").id, "object-enters-board"),
    /Unsupported filter field object\.id/
  );
  assert.throws(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => {} } }, kernel.getObject("colossus")),
    /Unsupported filter field object\.id/
  );
});

test("Jeweled Colossus: the expanded Vision look still fixes viewer A instead of the controller", () => {
  // 817.1.c / 437.1: the Predict viewer is the permanent's controller at
  // resolution time; the merged expansion still carries the placeholder "A",
  // and programs/ has no injection step (lifecycle.ts binds statics and
  // replacements only).
  const kernel = world().player("A").player("B").unit("colossus", { cardId: CANONICAL, owner: "B", controller: "B", types: ["unit"] }).build();
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const vision = binding.inspect(kernel.getObject("colossus")).abilities.find(ability => ability.kind === "triggered");
  assert.deepEqual(vision.body[0].args.player, { kind: "constant", value: "A" });
  assert.equal(vision.body[0].args.picksSpecId.value, "vision-top");
});

for (const recycle of [false, true]) {
  test(`Jeweled Colossus supported Vision body: ${recycle ? "recycle" : "keep"} the actual top card`, () => {
    const kernel = world().unit("colossus", { cardId: CANONICAL }).deck(["z-top", "a-bottom"]).build();
    const binding = createProgramBinding({ cardPrograms: [program] });
    const vision = binding.inspect(kernel.getObject("colossus")).abilities.find(ability => ability.kind === "triggered");
    const [look] = vision.body;
    const top = kernel.zoneSlice("A", "deck", "top", look.args.amount.value).map(object => object.ref);
    // This explicitly provisions the pending ordered-pick boundary; it is
    // evidence for the Predict body, not automatic production Vision binding.
    kernel.setPicks(look.args.picksSpecId.value, top);
    kernel.setAnswers({ ["vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck")]: recycle ? top : [] });
    const outcome = resolveChainBody(vision.body, kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], top);
    assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], recycle ? 1 : 0);
    assert.deepEqual(outcome.events.map(event => event.action), recycle ? ["look", "recycle"] : ["look"]);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), recycle ? ["a-bottom", "z-top"] : ["z-top", "a-bottom"]);
  });
}
