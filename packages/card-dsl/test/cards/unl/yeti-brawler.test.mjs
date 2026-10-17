import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/yeti-brawler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-372a2d2a0b9116fc9b30d8a6f4899848963d12a45cf804935f7f8f9d355c80be";
const SOURCE_TEXT =
  "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
  '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [ability] = program.abilities;
const [playGold] = ability.body;

test("unl-018-219 Yeti Brawler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-018-219 Yeti Brawler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /excess damage/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("unl-018-219 Yeti Brawler: 'When I conquer' trigger with the excess-damage clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c / 383.4.c.1: "When I conquer" is a Conquer Effect; "self" is the
  // conquering unit's controller.
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", player: "self" });
  // 383.2.a.1: the "if you assigned 3 or more excess damage" clause follows the
  // trigger condition directly and belongs to it; the count shape names the
  // damage-assignment ledger that has no merged evaluation (judgeReason).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "excess-damage-assigned-this-combat");
  assert.equal(ability.optional, false);
});

test("unl-018-219 Yeti Brawler: two Gold gear tokens are created on the Chain and played", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["yeti-brawler.play-gold"]);
  assert.equal(playGold.op, "effect.token");
  // 187.5: the printed "Gold gear token" is a defined token, so the definition id
  // is the printed name rather than invented statistics.
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 2 });
  // 350.2 / 440.2.c / 185.2.a: a played token is created on the Chain first;
  // creating it on the Board then playing would add a wrong Board entry.
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldTokens" });
  // The "exhausted" entry override (143.4 / 184.1 / 185.2.d) has no IR argument;
  // it is recorded in judgeReason and never faked by create-then-exhaust.
  assert.deepEqual(Object.keys(playGold.args).sort(), [
    "amount", "linkKey", "location", "mode", "token"
  ]);
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.linkedTo, undefined);
});

test("unl-018-219 Yeti Brawler: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-018-219 Yeti Brawler: the declared conquer filter fails the closed EventPattern vocabulary", () => {
  // RIFT-257's trigger adapter feeds the card filter through
  // translateTriggerFilter and validateTriggerSpec; the closed vocabulary only
  // accepts "conquered"/"held", so the declared "conquer" spelling is rejected
  // (the same gap unl/wuju-apprentice's Hunt registration records).
  const translated = translateTriggerFilter(ability.trigger.filter, "yeti-brawler", ability.trigger.at);
  assert.deepEqual(translated, { event: "conquer", player: "self" });
  const validated = validateTriggerSpec({ at: ability.trigger.at, filter: translated });
  assert.equal(validated.ok, false);
  assert.equal(
    validated.issues.some((issue) => issue.path === "trigger.filter.event"),
    true
  );
  // 383.4.c.2.a binds the trigger to the unit present at the conquering
  // battlefield; the emitted conquer wave carries only the scoring payload.
  assert.deepEqual(ability.trigger.filter, { event: "conquer", player: "self" });
});

test("unl-018-219 Yeti Brawler golden: the merged effect.token really plays defined tokens, but not gold", () => {
  // The declared amount/mode/location arguments are executable for a token that
  // has a definition: two Recruit tokens are created on the Chain and played
  // (440.2.c / 185.2.a). CR 187.5's Gold token is not in the frozen table, so the
  // primitive negates with the documented blockedReason instead of guessing.
  const kernel = world().player("A").deck(["A:1", "A:2", "A:3", "A:4"]).build();
  // The printed controller-base placeholder is a card-data spelling; the
  // reference kernel resolves the concrete playing player, so the execution
  // scenario substitutes the concrete base (the same substitution sibling
  // token-creation goldens use) and swaps in a token the frozen table defines.
  const defined = runInstruction(
    token,
    {
      ...playGold.args,
      token: { kind: "constant", value: "recruit" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(defined.result.status, "executed");
  assert.equal(defined.linked["goldTokens.amount"], 2);
  assert.equal(defined.linked["goldTokens.createdAmount"], 2);
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 2);

  const goldKernel = world().player("A").build();
  const gold = runInstruction(
    token,
    {
      ...playGold.args,
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: goldKernel }
  );
  assert.equal(gold.result.status, "negated");
  assert.equal(gold.result.reason, "impossible");
  assert.equal(gold.linked.goldTokens.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(goldKernel.objects.filter((object) => object.isToken).length, 0);
});

test.todo(
  "unl-018-219 Yeti Brawler: expose the conquer payload's assigned excess damage (CR 467.2.c.1–c.4: assigning vs dealing) " +
    "— the scoring payload has no payloadFields and ResolveContext has no damage-assignment ledger; the retained count shape " +
    "is satisfied by unrelated objects (engine batch 4/5)"
);

test.todo(
  "unl-018-219 Yeti Brawler: Gold gear token definition with its printed ability (CR 187.5) — effect.token's frozen table has no gold entry"
);

test.todo(
  "unl-018-219 Yeti Brawler: chain-create then play of the token through the production chain — chain/engine.ts routeAction " +
    "requires a registered CardProgram for the played object and tokens have no cardId (RIFT-257 follow-up)"
);

test.todo(
  "unl-018-219 Yeti Brawler: exhausted entry override on the created token (CR 143.4 / 184.1 / 185.2.d) — " +
    "effect.token's argsSchema rejects an extra entry-state argument and create-then-exhaust would add a spurious becomes-exhausted event"
);

test.todo(
  "unl-018-219 Yeti Brawler: register the conquer trigger — translateTriggerFilter keeps the card's \"conquer\" spelling and " +
    "validateTriggerSpec only accepts the closed vocabulary's \"conquered\"/\"held\" (RIFT-257 follow-up)"
);
