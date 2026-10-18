// Execution evidence for this card lives in ../templates/keyword-static-671.test.mjs (README 4.1); this
// card stays judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jax-unmatched.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import quickDraw from "../../../../engine-core/dist/effects/keywords/Quick-Draw.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { actionTimings } from "../../../../engine-core/dist/layers/rules/query.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CARD_ID = "card.hash-a83dac0c953bf9bfdee67886a82147cb411410a3e9967fae69b37320583c94f9";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)";

const [deflectAbility, grant] = program.abilities;
const gearProgram = {
  canonicalCardId: "test:jax-equipment", rulesetVersion: "core-1.5",
  status: "executable", sourceText: "Synthetic Equipment for the granted Quick-Draw probe.", abilities: []
};

function chainFor(kernel, registry = new ProgramRegistry([gearProgram])) {
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: (state) => kernel.restore(state),
    objects: () => kernel.objects, perform: (action) => kernel.perform(action),
    choose: (request) => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  return new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: (action, source) => describePlay(registry, action, source),
    cleanup: (engine) => {
      engine.layers.setObjects(kernel.objects);
      let changed = false;
      for (const object of engine.layers.evaluateAll()) {
        if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
            (object.might <= 0 || object.damage >= object.might)) {
          engine.commit({ type: "kill", object: object.ref });
          changed ||= kernel.getObject(object.ref.id)?.ref.zoneEntryId !== object.ref.zoneEntryId;
        }
      }
      return changed;
    }
  });
}

function boundQuickDrawTiming() {
  // Isolate the timing payload on the Board, where staticTarget's default
  // source filter applies. Hand-zone permission has its own TODO below.
  const kernel = world().unit("equipment", {
    cardId: gearProgram.canonicalCardId, types: ["gear"], keywords: [{ id: "quick-draw" }]
  }).build();
  const engine = chainFor(kernel);
  const source = kernel.getObject("equipment");
  const [timing] = expandProgram(gearProgram, source).expanded;
  createEngineStaticBinder(engine).bindStatic(timing, source);
  return { engine, source, timing };
}

test("sfd-054-221 Jax, Unmatched: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-054-221 Jax, Unmatched: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /动态 attach/);
  assert.match(program.judgeReason, /grantsFor/);
  assert.match(program.judgeReason, /staticTarget/);
  assert.doesNotMatch(program.judgeReason, /event\.source/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-054-221 Jax, Unmatched: [Deflect] keyword plus an Equipment-scoped Quick-Draw grant", () => {
  assert.equal(program.abilities.length, 2);
  // 809.1.b.3: a printed value-less Deflect presumes 1, so no `value` is authored here.
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  assert.equal(grant.kind, "static");
  assert.equal(grant.condition, undefined);
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "quick-draw");
  // 150.1/150.5: Equipment is the gear tag; 819 grants Quick-Draw to those gears
  // while they are in your hand (not on the Board).
  assert.deepEqual(grant.effect.filter, {
    zone: "hand",
    type: "gear",
    tags: ["Equipment"],
    controller: "controller"
  });
});

test("sfd-054-221 Jax, Unmatched: the Quick-Draw and Deflect keyword definitions are merged", () => {
  // 契约 3.7 / README 第 5 节：卡只声明关键词，展开归 effects/keywords/<keyword>.ts。
  assert.equal(quickDraw.keyword, "Quick-Draw");
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.stacking, "sum");
});

test("sfd-054-221 Jax, Unmatched: the granted keyword expands to Reaction timing and a play attach", () => {
  const expansion = quickDraw.expand({ host: { canonicalCardId: CARD_ID } });
  const [timing, attach] = expansion;
  // 819.1.b/c: Quick-Draw grants [Reaction] while the gear is in hand.
  assert.equal(timing.kind, "static");
  assert.equal(timing.effect.kind, "continuous.timing");
  assert.deepEqual(timing.effect.permissions, ["play", "attach"]);
  // 819.1.d: the play trigger attaches the gear to a friendly Unit (435).
  assert.equal(attach.kind, "triggered");
  assert.equal(attach.trigger.at, "card-played");
  assert.equal(attach.body[0].op, "effect.attach");
});

test("sfd-054-221 Jax, Unmatched golden: the Equipment-scoped grant really adds Quick-Draw in hand", () => {
  // 150.1/150.5: Equipment is the gear tag; 819: those gears have Quick-Draw
  // while in your hand. The merged continuous.grant-keyword primitive registers
  // the ability-layer effect and the layer engine reads the granted keyword; the
  // card's declared filter is used verbatim (with the binding's controller
  // normalization applied by the golden).
  const kernel = world()
    .unit("jax", { cardId: CARD_ID, types: ["unit"], might: 5 })
    .hand("equipment", { types: ["gear"], tags: ["Equipment"] })
    .hand("plain-gear", { types: ["gear"], tags: [] })
    .hand("equipment-spell", { types: ["spell"], tags: ["Equipment"] })
    .build();
  const normalizedFilter = {
    ...grant.effect.filter,
    controller: grant.effect.filter.controller === "controller" ? "self" : grant.effect.filter.controller
  };
  const effect = { ...grant.effect, filter: normalizedFilter };
  const layers = createLayerEngine(kernel.objects, [
    {
      effect: { id: "jax.grant-quick-draw", layer: "ability", source: kernel.ref("jax"), filter: normalizedFilter, effect },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);

  assert.deepEqual(layers.evaluate(kernel.ref("equipment")).keywords.map((keyword) => keyword.id), ["quick-draw"]);
  assert.deepEqual(layers.evaluate(kernel.ref("plain-gear")).keywords, []);
  // A spell with the Equipment tag is not a gear: 150.1 defines Equipment as a tag on Gear.
  assert.deepEqual(layers.evaluate(kernel.ref("equipment-spell")).keywords, []);
  // The same declared filter, evaluated by the engine's own matcher, agrees.
  assert.equal(matchesObjectFilter(normalizedFilter, kernel.getObject("equipment")), true);
});

test("sfd-054-221 Jax, Unmatched: the real Quick-Draw timing expansion enters the production static binder", () => {
  const { engine, source, timing } = boundQuickDrawTiming();
  const [registered] = engine.layers.registry.list();
  assert.equal(engine.layers.registry.list().length, 1);
  assert.equal(registered.effect.layer, "ability");
  assert.deepEqual(registered.effect.source, source.ref);
  assert.equal(registered.effect.effect.kind, "continuous.timing");
  // The binder unwraps expressions; assert the real expansion was installed.
  assert.equal(registered.effect.effect.value, timing.effect.value.value);
  assert.deepEqual(registered.effect.effect.permissions, ["play", "attach"]);
});

test("sfd-054-221 Jax, Unmatched: the current timing query still rejects Quick-Draw's value form", () => {
  const { engine, source } = boundQuickDrawTiming();
  // The registry contains the actual keyword timing, but actionTimings only
  // reads grants/timings while Quick-Draw emits value: reaction.
  assert.deepEqual(actionTimings(engine.layers.registry, source.ref, engine.layers.evaluate(source.ref), "A"), []);
});

test("sfd-054-221 Jax, Unmatched: the production play path keeps a layer-granted hand Equipment at normal speed", () => {
  const kernel = world()
    .unit("jax", { cardId: CARD_ID, types: ["unit"], might: 5 })
    .hand("equipment", { cardId: gearProgram.canonicalCardId, types: ["gear"], tags: ["Equipment"] })
    .build();
  const registry = new ProgramRegistry([gearProgram]);
  const engine = chainFor(kernel, registry);
  createEngineStaticBinder(engine).bindStatic(grant, kernel.getObject("jax"));
  const granted = engine.layers.evaluate(kernel.ref("equipment"));
  assert.deepEqual(granted.keywords.map((keyword) => keyword.id), ["quick-draw"]);
  const draft = describePlay(registry, { type: "play", object: kernel.ref("equipment"), player: "A" }, kernel.getObject("equipment"));
  assert.equal(draft.speed, "normal");
  assert.deepEqual(expandProgram(gearProgram, kernel.getObject("equipment")).expanded, []);
});

test("sfd-054-221 Jax, Unmatched: Quick-Draw's printed trigger matches the played gear", () => {
  // Isolate the trigger path with a gear that already has Quick-Draw. This
  // distinguishes event filtering from the layer-to-expansion gap above.
  const kernel = world().player("A", { energy: 10 }).player("B")
    .unit("jax", { cardId: CARD_ID, might: 5 })
    .hand("equipment", {
      cardId: gearProgram.canonicalCardId, types: ["gear"], tags: ["Equipment"],
      energy: 0, power: [], keywords: [{ id: "quick-draw" }]
    }).build();
  const registry = new ProgramRegistry([gearProgram]);
  const engine = chainFor(kernel, registry);
  kernel.setAnswers({ "target:quick-draw-unit": [kernel.ref("jax")] });
  attachProgramLifecycle(engine, registry, undefined, (error) => { throw error; });
  const draft = describePlay(registry, { type: "play", object: kernel.ref("equipment"), player: "A" }, kernel.getObject("equipment"));
  engine.execute(draft);
  assert.ok(engine.pipeline.events.some((event) => event.timingPoint === "card-played" && event.object.ref.id === "equipment"));
  assert.ok(engine.items.some((item) => item.body.some((instruction) => instruction.id === "quick-draw-attach")));
});

test("sfd-054-221 Jax, Unmatched: remaining production gaps are dynamic hand timing and Deflect tax wiring", () => {
  assert.match(program.judgeReason, /动态 attach/);
  assert.match(program.judgeReason, /hand-zone|手牌/);
  assert.match(program.judgeReason, /target\.tax/);
});
