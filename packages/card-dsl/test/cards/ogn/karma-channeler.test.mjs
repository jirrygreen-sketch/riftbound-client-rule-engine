import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/karma-channeler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import { createProgramBinding, translateInstructionTargets } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL = "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d";
const [vision, recycleTrigger] = program.abilities;
const [buffInstruction] = recycleTrigger.body;
const [friendlyUnit] = buffInstruction.targets;

test("ogn-235-298 Karma, Channeler: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-235-298 Karma, Channeler: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /card-recycled/);
  assert.match(program.judgeReason, /batchId/);
  assert.match(program.judgeReason, /批次/);
  assert.match(program.judgeReason, /vision-top picks/);
  assert.match(program.judgeReason, /未排除符文/);
  assert.match(program.judgeReason, /执行玩家/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "When you recycle one or more cards, buff a friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff. Runes aren't cards.)"
  );
});

test("ogn-235-298 Karma, Channeler: [Vision] is declared as a keyword ability", () => {
  // CR 817.1.b: Vision is functionally "When this is played, [Predict]"; the expansion lives
  // in engine-core/src/effects/keywords/Vision.ts (contract 3.7).
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
});

test("ogn-235-298 Karma, Channeler: the recycle clause is a mandatory buff of one friendly unit", () => {
  assert.equal(recycleTrigger.kind, "triggered");
  assert.equal(recycleTrigger.trigger.at, "card-recycled");
  // This provisional controller filter binds, but cannot identify the instructed recycler
  // of another player's card or exclude Runes (417.1.c, 052/161.1). Those gaps stay judged.
  assert.deepEqual(recycleTrigger.trigger.filter, { controller: "self" });
  assert.equal(recycleTrigger.optional, false);

  assert.equal(buffInstruction.id, "karma-channeler.buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "karma-channeler.friendly-unit" }
  });
  assert.equal(buffInstruction.targets.length, 1);
  assert.equal(friendlyUnit.id, "karma-channeler.friendly-unit");
  assert.deepEqual(friendlyUnit.filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });
  assert.equal(friendlyUnit.min, 1);
  assert.equal(friendlyUnit.max, 1);
  assert.equal(friendlyUnit.selection, "one");
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("ogn-235-298 Karma, Channeler: the recycle trigger is declared on the existing card-recycled timing point", () => {
  // Resolution still needs one trigger for the complete recycle batch.
  assert.equal(recycleTrigger.trigger.at, "card-recycled");
  assert.deepEqual(recycleTrigger.trigger.filter, { controller: "self" });
});

test("ogn-235-298 Karma, Channeler: the buff clause executes against a friendly unit (CR 702.2.a)", () => {
  const kernel = world().unit("karma").unit("ally").build();
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: friendlyUnit.id
  }, {
    world: kernel,
    targets: { [friendlyUnit.id]: [kernel.ref("ally")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(run.result.linkedValues.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test("ogn-235-298 Karma, Channeler: a unit that already has a buff is not buffed twice (CR 702.3.a)", () => {
  const kernel = world().unit("karma").unit("ally", { buffs: 1 }).build();
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: friendlyUnit.id
  }, {
    world: kernel,
    targets: { [friendlyUnit.id]: [kernel.ref("ally")] }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
  // The negated result carries no linkedValues object, but the primitive still publishes
  // the actual per-unit outcome through ctx.link (CR 427.1.c).
  assert.equal(run.linked.buffedCount, 0);
  assert.deepEqual(run.linked.buffed, []);
});

test("ogn-235-298 Karma, Channeler: the original buff body resolves with its friendly target restriction", () => {
  const requests = [];
  const f = fixture({
    cards: [{ id: "karma", cardId: CANONICAL }, { id: "ally" }],
    choose: request => {
      requests.push(request);
      if (request.type === "select-objects") return [request.options.find(ref => ref.id === "ally")];
    }
  });
  for (const id of ["karma", "ally"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "base", location: { type: "base", player: "A" } });
  }
  f.engine.advance();
  // Only the supported resolution body is under test. Recycle batch
  // collection remains blocked; no synthetic card is marked executable.
  f.engine.enqueue({
    id: "karma-buff-body", kind: "triggered", controller: "A", source: f.kernel.getObject("karma"),
    body: translateInstructionTargets(recycleTrigger.body)
  });
  f.engine.advance();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.some(ref => ref.id === "enemy"), false);
  assert.equal(f.kernel.getObject("ally").buffs, 0);
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("ally").buffs, 1);
  assert.equal(f.kernel.getObject("enemy").buffs, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "buff-added").length, 1);
});

test.todo(
  "Karma Vision: the keyword expansion (effects/keywords/Vision.ts) still emits object.id=self, which " +
    "programs/filters.ts rejects, and binds the inspect viewer as the constant A plus an ordered " +
    "resolution-time vision-top picks list (817.1.c, 437.1)"
);
test.todo(
  "Karma recycle trigger: one hit for the whole recycle batch (417.1); the merged pipeline emits one " +
    "card-recycled per recycle GameAction with no batchId producer and no per-batch once scope"
);

test("ogn-235-298 Karma, Channeler: the recycle trigger registers through the merged binding, the Vision expansion does not", () => {
  // The authored card-recycled subscription now uses the timing point's equivalent ObjectFilter
  // spelling, so THIS ability binds. The whole program still fails because the Vision keyword
  // expansion (engine-core/src/effects/keywords/Vision.ts) emits 'object.id', which the merged
  // filter translator rejects; that file is outside this task's write scope.
  const source = {
    ref: { id: "karma", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Karma, Channeler",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 3,
    energy: 5,
    power: ["Chaos"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const executable = { ...program, status: "executable", judgeReason: undefined };
  assert.throws(
    () => createProgramBinding({ cardPrograms: [executable] }).registerProgramTriggers({ pipeline: { registerTrigger: () => {} } }, source),
    /Unsupported filter field object\.id/
  );
  const recycleOnly = {
    ...executable,
    abilities: program.abilities.filter((ability) => ability.kind === "triggered")
  };
  const registered = [];
  const ids = createProgramBinding({ cardPrograms: [recycleOnly] })
    .registerProgramTriggers({ pipeline: { registerTrigger: (registration) => registered.push(registration) } }, source);
  assert.deepEqual(ids, ["program:karma:1:0"]);
  assert.equal(registered[0].spec.at, "card-recycled");
  assert.deepEqual(registered[0].spec.filter, { controller: "self" });
  assert.deepEqual(registered[0].activeZones, ["board"]);
});

for (const recycle of [false, true]) {
  test(`Karma supported Vision body: ${recycle ? "recycle" : "keep"} the seen top card`, () => {
    const kernel = world().unit("karma", { cardId: CANONICAL }).deck(["z-top", "a-bottom"]).build();
    const binding = createProgramBinding({ cardPrograms: [program] });
    const ability = binding.inspect(kernel.getObject("karma")).abilities.find(item => item.kind === "triggered" && item.trigger.at === "object-enters-board");
    const [look] = ability.body;
    const top = kernel.zoneSlice("A", "deck", "top", look.args.amount.value).map(object => object.ref);
    kernel.setPicks(look.args.picksSpecId.value, top);
    kernel.setAnswers({ ["vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck")]: recycle ? top : [] });
    const outcome = resolveChainBody(ability.body, kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], top);
    assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], recycle ? 1 : 0);
    assert.deepEqual(outcome.events.map(event => event.action), recycle ? ["look", "recycle"] : ["look"]);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), recycle ? ["a-bottom", "z-top"] : ["z-top", "a-bottom"]);
  });
}

// Isolate the recycle subscription because the unrelated Vision filter still
// prevents whole-program registration. Use the real pipeline and chain scanner.
function recycleFixture({ rune = false } = {}) {
  const builder = world()
    .unit("karma", { cardId: CANONICAL, might: 3 })
    .unit("enemy", { owner: "B", might: 5 })
    .deck(["A:deck:1", "A:deck:2", "A:deck:3"], { owner: "A" })
    .deck(["B:deck:1", "B:deck:2", "B:deck:3"], { owner: "B" });
  if (rune) builder.rune("rune");
  const kernel = builder.build();
  const choose = request => {
    if (request.type === "select-objects") return request.options.slice(0, request.min ?? 0);
    throw new Error(`Unexpected choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: engine => {
    engine.layers.setObjects(kernel.objects);
    let changed = false;
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === "board" && object.types.includes("unit") && object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
        engine.commit({ type: "kill", object: object.ref });
        changed = true;
      }
    }
    return changed;
  } });
  const binding = createProgramBinding({ cardPrograms: [{
    ...program, status: "executable", judgeReason: undefined, abilities: [recycleTrigger]
  }] });
  binding.registerProgramTriggers(engine, kernel.getObject("karma"));
  return { engine, kernel };
}

test("Karma supported recycle subscription: another player's single-card recycle does not trigger me", () => {
  const f = recycleFixture();
  f.engine.enqueue({ id: "opponent-recycle", kind: "triggered", controller: "B", source: f.kernel.getObject("enemy"), body: [{
    id: "opponent-recycle", op: "effect.recycle", args: {
      from: { kind: "constant", value: { zone: "deck", amount: { kind: "constant", value: 1 } } }
    }
  }] });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-recycled").length, 1);
  assert.equal(f.engine.trace.filter(entry => entry.step === "pending" && entry.item.startsWith("trigger:")).length, 0);
  assert.equal(f.kernel.getObject("karma").buffs, 0);
});

test("Karma TODO: one two-card recycle instruction collects one buff trigger", {
  todo: "417.1: card-recycled events need shared batch identity and per-batch trigger collection"
}, () => {
  const f = recycleFixture();
  f.engine.enqueue({ id: "recycle-two", kind: "triggered", controller: "A", source: f.kernel.getObject("karma"), body: [{
    id: "recycle-two", op: "effect.recycle", args: {
      from: { kind: "constant", value: { zone: "deck", amount: { kind: "constant", value: 2 } } }
    }
  }] });
  f.engine.advance();
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-recycled").length, 2);
  assert.equal(f.engine.items.filter(item => item.id.startsWith("trigger:")).length, 1);
});

test("Karma TODO: recycling a rune does not collect a buff trigger", {
  todo: "052/161.1: the card-recycled subscription must exclude Runes"
}, () => {
  const f = recycleFixture({ rune: true });
  f.engine.commit({ type: "channel-rune", player: "A", amount: 1 });
  f.engine.advance();
  f.engine.enqueue({ id: "recycle-rune", kind: "triggered", controller: "A", source: f.kernel.getObject("karma"), body: [{
    id: "recycle-rune", op: "effect.recycle", args: {
      from: { kind: "constant", value: { zone: "rune-zone", amount: { kind: "constant", value: 1 } } }
    }
  }] });
  f.engine.advance();
  assert.equal(f.kernel.getObject("rune").zone, "rune-deck");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-recycled").length, 1);
  assert.equal(f.engine.items.filter(item => item.id.startsWith("trigger:")).length, 0);
});
