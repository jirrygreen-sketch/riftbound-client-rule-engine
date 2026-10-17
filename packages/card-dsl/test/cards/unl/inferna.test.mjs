// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/inferna.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL_ID =
  "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "[Assault 2] (+2 :rb_might: while I'm an attacker.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("unl-002-219 Inferna: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-002-219 Inferna: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing keyword, the rule and the dependent task.
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  // Both KeywordDefs and CardProgram static binding are merged; the reason names
  // the remaining location-permission and designation consumers.
  assert.match(program.judgeReason, /play-location-permission|Finalize/);
  assert.match(program.judgeReason, /combatRole|designation/);
  assert.doesNotMatch(program.judgeReason, /RIFT-81|RIFT-91|RIFT-102|RIFT-257|RIFT-259|RIFT-266/);
  // The reason names the live binder rejections rather than a vague placeholder.
  assert.match(program.judgeReason, /no layer mapping|layerFor/);
  assert.match(program.judgeReason, /appliesTo/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-002-219 Inferna: Ambush keyword plus a valued Assault 2 declaration", () => {
  assert.equal(program.abilities.length, 2);
  // 822.1 / 822.1.a: Ambush is a Passive Ability keyword, normally on Units, and
  // it carries no value (822 has no numeric form).
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "ambush" });
  assert.equal(program.abilities[0].value, undefined);
  // 807.1.b.1-2: the printed "Assault 2" fixes the Assault Value at 2.
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault", value: 2 });
});

test("unl-002-219 Inferna: the declared Ambush and Assault keywords resolve to merged KeywordDefs", () => {
  const ambush = keywordDefinitionsById.get("Ambush");
  assert.ok(ambush, "effects/keywords/Ambush.ts must be in the generated keyword registry");
  // 822.1 / 822.1.a: Ambush is a Passive Ability keyword on Units with no value.
  assert.equal(ambush.valued, false);
  assert.ok(ambush.ruleRefs.includes("822.1.b"));
  const registered = keywordDefinitionsById.get("Assault");
  assert.ok(registered, "effects/keywords/Assault.ts must be in the generated keyword registry");
  assert.equal(registered, assault);
  // Card IR uses the lowercase keyword id; the registry is keyed by the printed name.
  assert.equal(program.abilities[1].keyword, registered.keyword.toLowerCase());
  // 807.2: same-named keywords from several sources sum into one Assault Value.
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("807.1.c"));
  assert.ok(registered.ruleRefs.includes("807.1.d.1"));
});

test("unl-002-219 Inferna: the merged program binding expands both keywords for this identity", async () => {
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const source = {
    ref: { id: "inferna", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "inferna",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 1,
    energy: 2,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = binding.inspect(source).abilities;
  // 822.1: Ambush expands to the play-location permission plus the Reaction
  // permission; 807.1.c: Assault expands to the attacker-gated static Might.
  assert.equal(expanded.filter(ability => ability.kind === "keyword").length, 2);
  const statics = expanded.filter(ability => ability.kind === "static");
  assert.equal(statics.length, 3);
  assert.deepEqual(
    statics.map(ability => ability.effect.kind).sort(),
    ["continuous.might", "continuous.timing", "play-location-permission"]
  );
  const might = statics.find(ability => ability.effect.kind === "continuous.might");
  assert.deepEqual(might.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(might.condition.left.property, "designation");
});

test("unl-002-219 Inferna: the Assault 2 expansion is +2 Might gated on the Attacker designation", () => {
  const expansion = assault.expand({ value: program.abilities[1].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // 807.1.c / 807.1.d.1: only while the Unit holds the Attacker designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("unl-002-219 Inferna: the expanded Assault ability validates as EffectIR for this identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: assault.expand({ value: program.abilities[1].value, host: HOST }),
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("unl-002-219 Inferna: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

/** The production static binder over a real ChainEngine, with this card's expansion. */
function boundStatics({ combatRole = null } = {}) {
  const kernel = world()
    .unit("inferna", { cardId: CANONICAL_ID, types: ["unit"], might: 1, combatRole })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const source = kernel.getObject("inferna");
  // inspect expands the original judge-required program without bypassing its
  // production status guard; only the resulting static abilities are bound here.
  const statics = createProgramBinding({ cardPrograms: [program] }).inspect(source).abilities
    .filter(ability => ability.kind === "static");
  return { kernel, engine, source, statics };
}

test("unl-002-219 Inferna: the merged static binder rejects both Ambush declarations", () => {
  // 822.1.b / 822.1.c: the [Ambush] expansion declares a play-location permission
  // plus the conditional Reaction timing. programs/statics.ts has no layer for the
  // first and no card-scoped appliesTo for the second, so neither can enter the
  // layer system; the card stays judge-required instead of granting a global Reaction.
  const { engine, source, statics } = boundStatics();
  const ambushKinds = statics.map(ability => ability.effect.kind);
  assert.deepEqual(ambushKinds, ["play-location-permission", "continuous.timing", "continuous.might"]);
  const binder = createEngineStaticBinder(engine);

  assert.throws(
    () => binder.bindStatic(statics[0], source),
    error => {
      assert.equal(error.name, "ProgramBindingError");
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /play-location-permission has no layer mapping/);
      return true;
    }
  );
  assert.throws(
    () => binder.bindStatic(statics[1], source),
    error => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /Unsupported static appliesTo \["card"\]/);
      return true;
    }
  );
  // Neither rejection leaves a registration behind: the card grants nothing.
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("unl-002-219 Inferna: the merged Assault 2 static binds but leaves an attacker at printed Might", () => {
  // 807.1.c / 807.1.d.1: the expansion is a real static ability bound through the
  // production binder. Its condition reads the host's "designation", but
  // ObjectSnapshot exposes combatRole, so evaluateCondition raises
  // MissingInformation and programs/statics.ts catches it as false: even while the
  // unit holds the Attacker designation the +2 does not apply.
  const { engine, source, statics } = boundStatics({ combatRole: "attacker" });
  assert.equal(source.combatRole, "attacker");
  const assaultAbility = statics.find(ability => ability.effect.kind === "continuous.might");
  assert.deepEqual(assaultAbility.effect.amount, { kind: "constant", value: 2 });
  assert.equal(assaultAbility.condition.left.property, "designation");
  assert.equal(Object.hasOwn(source, "designation"), false);

  const handle = createEngineStaticBinder(engine).bindStatic(assaultAbility, source);
  try {
    assert.equal(engine.layers.registry.list().length, 1);
    // 143.2.a: Effective Might is what matters; Assault must not be assumed to work.
    assert.equal(engine.layers.snapshot(source.ref).might, 1);
  } finally {
    handle.unbind();
  }
  assert.deepEqual(engine.layers.registry.list(), []);
});

test.todo(
  "unl-002-219 Inferna: consume Ambush's battlefield play-location permission (CR 822.1.b/.c) at Finalize " +
    "and keep its Reaction permission scoped to that play"
);

test.todo(
  "unl-002-219 Inferna: apply Assault 2 as +2 Might exactly while the unit holds the Attacker designation " +
    "(CR 807.1.c / 807.1.d.1) — the condition reads designation while ObjectSnapshot exposes combatRole"
);
