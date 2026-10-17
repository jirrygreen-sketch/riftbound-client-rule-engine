import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sprite-fountain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-662d7db819f7136f036d9502c7ad7c650275c0c5bf7b8bd26034395aafbd7c0c";
const SOURCE_TEXT =
  "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
  "When you play this, play a ready 3 :rb_might: Sprite unit token with [Temporary] to your base.\n" +
  "[Deathknell][>] Repeat this gear's play effect. (When this dies, get the effect.)";

const [temporary, playEffect, deathknellKeyword, repeatPlayEffect] = program.abilities;
const [playSprite] = playEffect.body;
const [repeatInstruction] = repeatPlayEffect.body;

test("unl-078-219 Sprite Fountain: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Sprite token/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /383\.4\.g/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("unl-078-219 Sprite Fountain: identity, ruleset, status and the verbatim three-line source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.sourceText.split("\n").length, 3);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-078-219 Sprite Fountain: [Temporary] and [Deathknell] are declared, not re-implemented", () => {
  assert.equal(program.abilities.length, 4);
  // 816.1: Temporary carries no numeric parameter (816.2 makes duplicates redundant).
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });
  // 808.1: Deathknell is declared as its own keyword instance.
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
});

test("unl-078-219 Sprite Fountain: the play effect is a self card-played trigger playing a Sprite", () => {
  // 383.4.a / 383.4.a.1: the printed "When you play this" is a Play Effect of the card itself.
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playEffect.optional, false);
  assert.equal(playEffect.body.length, 1);

  assert.equal(playSprite.id, "sprite-fountain.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 187.2 / 440.2.c / 185.2.a: a played token is created on the Chain and completed by the
  // play procedure, so the token is named and sent through mode "play".
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  // "to your base": the controller's Base.
  assert.deepEqual(playSprite.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // "ready" is an entry stipulation (143.4 / 185.2.d), never a follow-up effect.ready.
  assert.equal(playSprite.args.entersReady, undefined);
  assert.equal(playSprite.args.entersExhausted, undefined);
  assert.equal(playSprite.linkedTo, undefined);
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
});

test("unl-078-219 Sprite Fountain: the Deathknell effect is the named Play Effect repetition", () => {
  // 808.1.b / 808.1.b.1: the [Effect] of this Deathknell instance is "Repeat this gear's
  // play effect."; 808.1.c makes it functionally "When I die, [Effect]".
  assert.equal(repeatPlayEffect.kind, "triggered");
  assert.equal(repeatPlayEffect.trigger.at, "object-killed");
  assert.deepEqual(repeatPlayEffect.trigger.filter, {
    self: true,
    cause: "kill",
    destination: "trash"
  });
  assert.equal(repeatPlayEffect.optional, false);
  assert.equal(repeatPlayEffect.body.length, 1);

  assert.equal(repeatInstruction.id, "sprite-fountain.repeat-play-effect");
  // 383.4.g / 383.4.g.1: the named effect is this card's own Play Effect; the named part is
  // treated as fulfilled, the other conditions are still checked, and no real event fires
  // (383.4.g.2).
  assert.deepEqual(repeatInstruction.args.namedTrigger, {
    kind: "constant",
    value: "play-effect"
  });
  assert.deepEqual(repeatInstruction.args.scope, {
    kind: "constant",
    value: { source: "self" }
  });
  assert.deepEqual(repeatInstruction.args.checkOtherConditions, {
    kind: "constant",
    value: true
  });
  assert.deepEqual(repeatInstruction.args.emitOriginalEvent, {
    kind: "constant",
    value: false
  });
  assert.equal(repeatInstruction.linkedTo, undefined);
  assert.equal(repeatInstruction.targets, undefined);
});

test("unl-078-219 Sprite Fountain golden: a merged token definition creates a real board object", () => {
  // effect.token resolves a definition id and creates the token through the frozen
  // create-token action; the authored Sprite arguments are asserted structurally above.
  const kernel = world()
    .unit("fountain", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fountain") });
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 1 },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "created" }
    },
    { world: context }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.created.amount, 1);
  assert.equal(context.objects.filter((object) => object.isToken).length, 1);
});

test("unl-078-219 Sprite Fountain golden: the printed Temporary kill removes a board permanent", () => {
  // 816.1.b / 816.1.c: the Temporary expansion is "at the controller's Beginning Phase
  // start, kill this". The kill half is executable today; the phase subscription is not.
  const kernel = world()
    .unit("sprite", { owner: "A", might: 3, tags: ["Fae"], isToken: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("sprite") });

  const run = runInstruction(kill, { self: true }, { world: context });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [kernel.ref("sprite")]);
  assert.equal(context.getObject("sprite").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("unl-078-219 Sprite Fountain: the card's own Sprite name is refused instead of substituted", () => {
  // 187.2: the printed Sprite carries its own Temporary ability, so the merged
  // token table refuses it with a documented blockedReason rather than playing a
  // different token (judgeReason item 1).
  const kernel = world().player("A").build();
  const sprite = runInstruction(
    token,
    {
      token: playSprite.args.token,
      amount: playSprite.args.amount,
      mode: playSprite.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playSprite.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(sprite.result.status, "negated");
  assert.equal(sprite.linked.spriteToken.amount, 0);
  assert.equal(sprite.linked.spriteToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({ zone: "board" }).length, 0);
});

test("unl-078-219 Sprite Fountain golden: the merged Temporary expansion kills the host at beginning-start (CR 816.1.b)", () => {
  // 816.1.b/816.1.c: the keyword definition is merged and its body is the merged
  // effect.kill; what is missing is the subscription (judgeReason item 3).
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  const [trigger] = temporary.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "beginning-start");
  assert.equal(trigger.optional, false);

  const kernel = world()
    .unit("fountain", { types: ["gear"], might: null, zone: "board", keywords: [{ id: "Temporary" }] })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fountain") });
  const outcome = resolveChainBody(trigger.body, context);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(context.getObject("fountain").zone, "trash");
});

test.todo(
  "unl-078-219 Sprite Fountain: add the CR 187.2 Sprite token definition (3 Might, domainless, Fae tag, " +
    "[Temporary]) to effect.token and support the printed ready entry state (143.4 / 185.2.d) — the merged table " +
    "carries only ability-free tokens and effect.token states that entry overrides are not supported; a follow-up " +
    "effect.ready is not equivalent"
);
test.todo(
  "unl-078-219 Sprite Fountain: the Temporary keyword expansion (816.1.b / 816.1.c) must subscribe to " +
    "beginning-start and kill the host before scoring — the KeywordDef body executes above, but no card program's " +
    "keyword abilities are registered at runtime (RIFT-257)"
);
test.todo(
  "unl-078-219 Sprite Fountain: activate/repeat a named triggered ability (CR 383.4.g.1) through an internal " +
    "chain entry for the Deathknell effect; the authored opcode is an unregistered placeholder"
);
test.todo(
  "unl-078-219 Sprite Fountain: the Deathknell expansion still references the unmerged trigger.leave primitive " +
    "(effects/keywords/Deathknell.ts); RIFT-82"
);
