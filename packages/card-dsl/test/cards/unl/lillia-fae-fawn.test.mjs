import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lillia-fae-fawn.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import effectReady from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /token 定义表|token definition/i);
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

test.todo(
  "unl-082-219 Lillia, Fae Fawn: register the 3 Might Sprite definition (CR 187.2: domainless, Fae tag, " +
    "Temporary) in the effect.token table — the current token definition table has no Sprite entry"
);
test.todo(
  "unl-082-219 Lillia, Fae Fawn: bind 'there' to the location recorded by the trigger condition " +
    "(CR 359.3.f.3) — the frozen ObjectSelector set has no trigger-payload form (contract change request)"
);
test.todo(
  "unl-082-219 Lillia, Fae Fawn: fire the object-moved trigger from the real Move flow with the " +
    "fromKind/fromLocationId payload and the self anchor (CR 421.1 / 449.1-2)"
);
test.todo(
  "unl-082-219 Lillia, Fae Fawn: the [Temporary] keyword expansion kills the Sprite at its controller's " +
    "Beginning Phase start before scoring (CR 816.1.b) — the keyword expansion and kill body are merged, but the " +
    "Sprite/there path cannot yet create a real token to register"
);
test.todo(
  "unl-082-219 Lillia, Fae Fawn: pay the [Accelerate] additional cost at Finalize and enter ready " +
    "(CR 805.1.b / 805.6) — programs/play.ts has no CardProgram → Finalize optionalAdditional wiring"
);
