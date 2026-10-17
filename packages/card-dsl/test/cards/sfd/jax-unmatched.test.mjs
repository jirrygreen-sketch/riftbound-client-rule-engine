import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jax-unmatched.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import quickDraw from "../../../../engine-core/dist/effects/keywords/Quick-Draw.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a83dac0c953bf9bfdee67886a82147cb411410a3e9967fae69b37320583c94f9";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)";

const [deflectAbility, grant] = program.abilities;

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
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-257/);
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
  // 819.1.a: Quick-Draw grants [Reaction] while the gear is in hand.
  assert.equal(timing.kind, "static");
  assert.equal(timing.effect.kind, "continuous.timing");
  assert.deepEqual(timing.effect.permissions, ["play", "attach"]);
  // 819.1.b/c: the play trigger attaches the gear to a friendly Unit (435).
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

test.todo(
  "sfd-054-221 Jax, Unmatched: 'Each Equipment in your hand has [Quick-Draw]' must be installed from the " +
    "CardProgram into the layers engine — RIFT-257's attachProgramLifecycle only calls the bindStatic " +
    "callback slot (default no-op) and has no layer registration, so the declared static grant never " +
    "becomes an active effect"
);

test.todo(
  "sfd-054-221 Jax, Unmatched: the granted Quick-Draw's continuous.timing permission and its card-played " +
    "attach trigger must reach the chain/target pipeline, and [Deflect]'s target tax must be collected as " +
    "any-domain Power (809.1.c.1) rather than the Energy-shaped tax the chain builds today — " +
    "continuous.timing has no chain.canAct consumer (P0 contract 3.5) and the Deflect tax consumer is missing (RIFT-90)"
);
