import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/walking-roost.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-51c4e6e520ee820d879fd83a63fbe09eed92fc00f5b8f7db1f68e18dd93f2154";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When you play me, choose an opponent. They play a 1 :rb_might: Bird unit token with [Deflect].";

const [keyword, triggered] = program.abilities;
const [chooseOpponent, playBird] = triggered.body;

test("unl-130-219 Walking Roost: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-130-219 Walking Roost: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /bird/);
  assert.match(program.judgeReason, /target\.player/);
  // The refreshed reason also names the observed registration failure for the
  // Deflect expansion and the fail-closed token destination.
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);

});

test("unl-130-219 Walking Roost: unvalued Deflect (809.1.b.3) plus the card-played self trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  // 383.4.a.1 / 383.4.a.2: a Play Effect that fires once the play completes.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
});

test("unl-130-219 Walking Roost: choose-an-opponent is a player choice, not an object target", () => {
  assert.equal(chooseOpponent.id, "walking-roost.choose-opponent");
  // 355.7 names a Player; the frozen target/pick vocabulary cannot carry it (see judgeReason).
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);
  assert.equal(chooseOpponent.picks, undefined);
});

test("unl-130-219 Walking Roost: the Bird token is played by the chosen opponent (linked to the choice)", () => {
  assert.equal(playBird.id, "walking-roost.play-bird");
  assert.equal(playBird.op, "effect.token");
  // 187.7: the 1 [M] Bird token is domainless, 1 Might, Bird tag and carries Deflect itself.
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain and handed to the play procedure.
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  // The destination belongs to the chosen opponent; the frozen IR has no seat binding, so the card
  // carries a descriptive value (see judgeReason / the contract change request in the reply).
  assert.deepEqual(playBird.args.location, {
    kind: "constant",
    value: { type: "base", player: "chosen-opponent" }
  });
  assert.deepEqual(Object.keys(playBird.args).sort(), ["amount", "linkKey", "location", "mode", "token"]);
  // "They play …" refers to the opponent chosen by the previous instruction, so it is linked to that
  // choice (355.7); the card writes no token-local Deflect expansion of its own.
  assert.equal(playBird.linkedTo, "walking-roost.choose-opponent");
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
});

test("unl-130-219 Walking Roost: the declared keyword id matches the merged Deflect KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "effects/keywords/Deflect.ts must be in the generated keyword registry");
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, true);
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("809.1.b.3"));
});

test("unl-130-219 Walking Roost gap: the Bird definition and the player-choice op are both unregistered", () => {
  // 187.7 needs a Bird token (domainless, 1 Might, Bird tag, Deflect). The frozen
  // table has no entry: the primitive negates with a blocked reason instead of
  // inventing a keyword-less substitute.
  const f = fixture();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "bird" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: f.kernel, controller: "A" }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(run.linked.token.objects, []);
  // 355.7: choosing an opponent is a player choice. There is no target.player op
  // and no player-shaped ChoiceRequest, so the instruction cannot run at all.
  assert.equal(instructionDefinitionsById.has("target.player"), false);
});

test("unl-130-219 Walking Roost gap: the descriptive chosen-opponent base is refused, never mis-placed", () => {
  // The card keeps a descriptive destination because the IR cannot name the chosen
  // opponent's seat. effect.token requires a concrete PlayerId, so the value is
  // negated: no token is ever created at the wrong player's base.
  const kernel = world().unit("roost", { might: 6 }).build();
  const before = kernel.query({ zone: "board" }).length;
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "bird" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: playBird.args.location
    },
    { world: kernel, controller: "A" }
  );
  assert.equal(run.result.status, "negated");
  assert.deepEqual(run.linked.token.objects, []);
  assert.equal(run.linked.token.amount, 0);
  // Nothing was created, and no token landed at either base (the reference
  // kernel's set query does not support an isToken predicate, so the token
  // count is read from the receipt and from the unchanged board size).
  assert.equal(kernel.query({ zone: "board" }).length, before);
  assert.deepEqual(run.events, []);
});

test("unl-130-219 Walking Roost gap: the expanded Deflect declaration has no layer mapping", () => {
  // 809.1.c.1: the tax is paid in Power of any Domain. The keyword expansion only
  // produces a static target.tax declaration, and the production static binder has
  // no layer for that kind, so no tax can ever be collected.
  const f = fixture({ cards: [{ id: "roost", cardId: CARD_ID, types: ["unit"], might: 6 }] });
  const expansion = keywordDefinitionsById.get("Deflect").expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(expansion[0], f.kernel.getObject("roost")),
    /Static ability kind target\.tax has no layer mapping/
  );
  // The trigger binding itself works, which is why only the token/player/tax
  // halves stay judged.
  const { judgeReason: _reason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = { ...f.kernel.getObject("roost"), keywords: [] };
  assert.deepEqual(binding.registerProgramTriggers(f.engine, source).length, 1);
});
test.todo(
  "unl-130-219 Walking Roost: add the CR 187.7 1 [M] Bird token (domainless, 1 Might, Bird tag, Deflect) to the " +
    "token definitions — effect.token's frozen table has no bird entry"
);
test.todo(
  "unl-130-219 Walking Roost: choose an opponent and let that opponent play the Bird token (CR 355.7 player choice, " +
    "440.4 controller) — the merged IR has no target.player primitive or player-choice request type"
);
test.todo(
  "unl-130-219 Walking Roost: charge the Deflect additional cost when an opponent chooses this unit (CR 809.1.c, " +
    "target.tax) — the merged static producer/consumer still needs RIFT-360"
);
