import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lillia-fae-fawn.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import effectToken from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import effectReady from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-e7fb971d15005249a31882c5cfd8d34fe0a7c9bc54b39b4b466e719f4798f333";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
  "When I move from a location, play a 3 :rb_might: Sprite unit token with [Temporary] there. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [accelerate, ability] = program.abilities;
const [playSprite] = ability.body;

test("unl-082-219 Lillia, Fae Fawn: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-082-219 Lillia, Fae Fawn: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Sprite/);
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /359\.3\.f\.3/);
  assert.match(program.judgeReason, /冻结定义表|token definition/i);
  // Re-checked against the merged sources: the Move trigger is rejected by the
  // closed event vocabulary, the Sprite definition is still missing, "there"
  // still has no trigger-payload selector, and accelerate.cost has no layer
  // mapping.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /ProgramBindingError/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-082-219 Lillia, Fae Fawn: [Accelerate] keyword accompanies one Move trigger", () => {
  // CR 805.1: Accelerate is an optional additional-cost keyword with no
  // printed value on this card; the card only declares it.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.equal(accelerate.value, undefined);
  assert.equal(ability.kind, "triggered");
  // CR 421.1 / 449.1-2: a successful Move is the object-moved timing point;
  // 458/458.1 excludes Recall, which never emits the Move timing point.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
});

test("unl-082-219 Lillia, Fae Fawn: the Sprite play keeps the printed definition, entry and 'there' binding", () => {
  assert.equal(playSprite.id, "lillia-fae-fawn.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 187.2: a 3 Might domainless Sprite token with the Fae tag and Temporary.
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: the played token is created on the Chain first.
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  // CR 359.3.f.3 names this exact card: the destination is the location noted
  // by the trigger condition when it was fulfilled. No merged selector can name
  // a trigger payload field, so the exact binding is kept as data.
  assert.deepEqual(playSprite.args.location, {
    kind: "constant",
    value: { triggerPayload: "object-moved", field: "fromLocationId" }
  });
  assert.deepEqual(playSprite.args.linkKey, { kind: "constant", value: "spriteToken" });
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
  assert.equal(playSprite.linkedTo, undefined);
});

test("unl-082-219 Lillia, Fae Fawn: merged Accelerate and Temporary definitions expose executable bodies", () => {
  const accelerateDefinition = keywordDefinitionsById.get("Accelerate");
  assert.ok(accelerateDefinition, "keywords/Accelerate.ts must be registered");
  const accelerateExpansion = accelerateDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(accelerateExpansion.length, 2);
  assert.equal(accelerateExpansion[0].effect.kind, "accelerate.cost");
  assert.equal(accelerateExpansion[1].kind, "replacement");
  assert.equal(accelerateExpansion[1].with[0].op, "effect.ready");
  const exhausted = world().unit("unit", { exhausted: true }).build();
  const readyRun = runInstruction(effectReady, { objects: exhausted.ref("unit") }, { world: exhausted });
  assert.equal(readyRun.result.status, "executed");
  assert.equal(exhausted.getObject("unit").exhausted, false);

  const temporaryDefinition = keywordDefinitionsById.get("Temporary");
  assert.ok(temporaryDefinition, "keywords/Temporary.ts must be registered");
  const temporaryExpansion = temporaryDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(temporaryExpansion[0].trigger.at, "beginning-start");
  const token = world().unit("sprite", { zone: "board" }).build();
  const killRun = runInstruction(kill, { target: "sprite" }, {
    world: token,
    targets: { sprite: [token.ref("sprite")] }
  });
  assert.equal(killRun.result.status, "executed");
  assert.equal(token.getObject("sprite").zone, "trash");
});

test("unl-082-219 Lillia, Fae Fawn: the Move trigger is rejected by the closed event vocabulary (CR 421.1 / 449.1-2)", () => {
  // The card authors the intent with the object-moved timing point, but
  // EVENT_PATTERN_TYPES (events/trigger-spec.ts) does not contain it, so the
  // production registration path cannot subscribe this trigger.
  const translated = translateTriggerFilter(ability.trigger.filter, "lillia");
  assert.equal(translated.event, "object-moved");
  assert.throws(
    () => assertTriggerSpec({ at: ability.trigger.at, filter: translated }),
    (error) => error.name === "TriggerSpecValidationError" &&
      error.issues.some((issue) => issue.code === "invalid-event-type")
  );
  const f = fixture({
    cards: [{ id: "lillia", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Mind"], might: 3 }]
  });
  const source = { ...f.kernel.getObject("lillia"), cardId: CANONICAL_ID, zone: "board" };
  // Inspecting the authored program still applies its status guard, so the
  // trigger registration is exercised through the lifted copy used by the
  // other goldens in this file.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  assert.throws(
    () => createProgramBinding({ cardPrograms: [lifted] }).registerProgramTriggers(f.engine, source),
    (error) => error.name === "TriggerSpecValidationError" &&
      error.issues.some((issue) => issue.code === "invalid-event-type")
  );
});

test("unl-082-219 Lillia, Fae Fawn: no Sprite token can be created (CR 187.2)", () => {
  // The frozen effect.token definition table has no Sprite entry, so the printed
  // play of a 3 Might domainless Fae Sprite with [Temporary] is impossible.
  const kernel = world()
    .unit("lillia", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(effectToken, playSprite.args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked.spriteToken.objects, []);
  assert.equal(run.linked["spriteToken.amount"], 0);
  // The contrast case: a defined token with a concrete location really plays.
  const contrast = world()
    .unit("lillia", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const defined = runInstruction(effectToken, {
    token: { kind: "constant", value: "recruit" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } }
  }, { world: contrast });
  assert.equal(defined.result.status, "executed");
  assert.equal(defined.linked["token.amount"], 1);
});

test("unl-082-219 Lillia, Fae Fawn: [Accelerate]'s static cost declaration has no layer mapping (CR 805.1.b)", () => {
  const definition = keywordDefinitionsById.get("Accelerate");
  const [costAbility] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(costAbility.effect.kind, "accelerate.cost");
  const f = fixture({
    cards: [{ id: "lillia", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Mind"], might: 3 }]
  });
  const source = { ...f.kernel.getObject("lillia"), cardId: CANONICAL_ID, zone: "board" };
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(costAbility, source),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
});
test.todo(
  "unl-082-219 Lillia, Fae Fawn: bind 'there' to the location recorded by the trigger condition " +
    "(CR 359.3.f.3) — the frozen ObjectSelector set has no trigger-payload form (contract change request)"
);
test.todo(
  "unl-082-219 Lillia, Fae Fawn: the [Temporary] keyword expansion kills the Sprite at its controller's " +
    "Beginning Phase start before scoring (CR 816.1.b) — the keyword expansion and kill body are merged, but its " +
    "beginning-start timing is outside the closed event vocabulary and the Sprite/there path cannot create a real token"
);
