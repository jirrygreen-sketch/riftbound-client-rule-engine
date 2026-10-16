import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sprite-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-6f54620dc8f77d546cac09d65f9233740f7ec347a9981fbe6aae3fed0b9f3ef7";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [hiddenKeyword, actionKeyword, play] = program.abilities;
const [playSprite] = play.body;
// The printed ready-entry stipulation is a descriptive argument: the merged
// effect.token schema has no entry-override field, so the primitive runs use
// only the arguments it actually consumes. The reference kernel resolves the
// playing player itself, so the printed controller-base placeholder is
// substituted with the concrete base (the same substitution sibling
// token-creation goldens use).
const { entersReady, ...supportedArgs } = playSprite.args;
const evaluatedArgs = {
  ...supportedArgs,
  location: { kind: "constant", value: { type: "base", player: "A" } }
};

test("ogn-094-298 Sprite Call: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-094-298 Sprite Call identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-094-298 Sprite Call judgeReason names the definition, the entry state and the dependencies", () => {
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /185\.3\.a/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /RIFT-82/);
});

test("ogn-094-298 Sprite Call structure: [Hidden] + [Action] keywords plus one token-play instruction", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(hiddenKeyword.value, undefined);
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(playSprite.id, "sprite-call.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 440.2.c / 185.2.a: a played token is created on the Chain and handed to
  // the play flow.
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  // 143.4 / 185.2.d: "ready" is the printed entry state, not a later effect.
  assert.deepEqual(playSprite.args.entersReady, { kind: "constant", value: true });
  assert.deepEqual(playSprite.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playSprite.args.linkKey, { kind: "constant", value: "sprite" });
  // The Sprite itself is not targeted: the card creates it, it does not
  // choose it (355.7), so no TargetSpec is declared.
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
  assert.equal(playSprite.linkedTo, undefined);
  assert.equal(playSprite.condition, undefined);
});

test("ogn-094-298 Sprite Call: the declared dependencies really are unregistered, and the block is explicit", () => {
  // The keyword registry has neither Hidden's cost.hidden consumer nor
  // Temporary; the instruction registry has effect.token but its frozen
  // definition table has no sprite entry and no entry override.
  assert.equal(keywordDefinitionsById.has("Hidden"), true);
  assert.equal(keywordDefinitionsById.has("Action"), true);
  assert.equal(keywordDefinitionsById.has("Temporary"), false);
  assert.equal(instructionDefinitionsById.get("effect.token"), token);

  const kernel = world().build();
  const run = runInstruction(token, evaluatedArgs, { world: kernel });

  // The merged primitive negates with a documented blockedReason instead of
  // inventing a token: the wrong-token shortcut and the fake ready/entry
  // override are both refused.
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked["sprite.amount"], 0);
  assert.deepEqual(run.linked["sprite.objects"], []);
  assert.equal(run.linked.sprite.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({}).length, 0);
});

test("ogn-094-298 Sprite Call golden: the same shape with a merged definition really creates and plays a token", () => {
  // Proves the instruction shape itself is the merged play-mode handoff
  // (440.2.c / 185.2.a): only the Sprite definition and its entry state are
  // missing, so no semantics are invented for the card.
  const kernel = world().build();
  const outcome = resolveChainBody([{
    ...playSprite,
    args: {
      ...evaluatedArgs,
      token: { kind: "constant", value: "mech" }
    }
  }], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].location, { type: "base", player: "A" });
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
});

test.todo(
  "Sprite Call: the 3 Might domainless Fae Sprite with Temporary (CR 187.2 / 185.3.a null cost) as a " +
    "resolvable token definition, including its Temporary trigger (816.1.b) - the frozen effect.token table " +
    "holds only definitions with no additional abilities"
);

test.todo(
  "Sprite Call: entering ready instead of the default exhausted entry (143.4 / 185.2.d) needs an entry " +
    "override on the creation/play action; the merged action documents that entry overrides are unsupported"
);

test.todo(
  "Sprite Call: [Hidden]'s Hide action and facedown play permission (811.1.b/811.1.c/811.1.d, cost.hidden) " +
    "belong to the keyword expansion consumers (RIFT-84), and [Action] admission (806.1.b) to the chain's " +
    "canAct check plus the continuous.timing consumer (RIFT-91)"
);
