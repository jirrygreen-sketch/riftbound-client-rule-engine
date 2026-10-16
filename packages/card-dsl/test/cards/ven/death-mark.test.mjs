import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/death-mark.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-abf7e6ef39804eabe153a1ee70a3ec9ebdb7f4da0b7ad72855b0aa57798dd5c2";
const SOURCE_TEXT =
  "[Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)\n" +
  "Play a 0 :rb_might: Shadow Clone unit token. (It has \"When I attack, you may banish a unit " +
  "from your trash. If you do, give me [Assault 4] this turn.\")\n" +
  "[Flow] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [burnThree, playShadowClone] = play.body;

const deckIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "deck", "top").map((object) => object.ref.id);
const trashIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "trash", "top").map((object) => object.ref.id);

test("ven-144-166 Death Mark: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-144-166 Death Mark: judgeReason names the token definition, its ability closure and Flow", () => {
  assert.match(program.judgeReason, /187\.11/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-144-166 Death Mark: [Flow] plus the Burn 3 and Shadow Clone instructions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["death-mark.burn-3", "effect.mill"],
    ["death-mark.play-shadow-clone", "effect.token"]
  ]);

  // "[Burn 3]": 441.1/441.2/441.4 — the burner defaults to the ability controller
  // (190.6.d); deck order and the Burn Out continuation stay with the kernel.
  assert.deepEqual(burnThree.args, { amount: { kind: "constant", value: 3 } });
  assert.equal(burnThree.targets, undefined);
  assert.equal(burnThree.picks, undefined);
  assert.equal(burnThree.linkedTo, undefined);

  // "Play a 0 Might Shadow Clone unit token": 440.2.c/185.2.a create on the Chain then play.
  assert.deepEqual(playShadowClone.args, {
    token: { kind: "constant", value: "shadow-clone" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "controller" } },
    linkKey: { kind: "constant", value: "shadowClone" }
  });
  // The token is created, not chosen (355.7), so it is never a target.
  assert.equal(playShadowClone.targets, undefined);
  assert.equal(playShadowClone.picks, undefined);
  // The two sentences are independent (158.1): the token play does not reference the burn.
  assert.equal(playShadowClone.linkedTo, undefined);
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
  assert.equal(keywordDefinitionsById.has("Flow"), true);
});

test("ven-144-166 Death Mark golden: [Burn 3] moves the top 3 cards of the Main Deck to trash in order", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).build();

  const outcome = resolveChainBody([burnThree], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["death-mark.burn-3", "executed"]
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["mill"]);
  // 441.1: the top three leave in top-to-bottom order; the fourth stays on top.
  assert.deepEqual(deckIds(kernel), ["fourth"]);
  // The trash keeps entry order: the first-burned top card lands first (108.2.c: unordered in play).
  assert.deepEqual(trashIds(kernel), ["top", "second", "third"]);
  assert.equal(outcome.linkedValues["death-mark.burn-3.burnedCount"], 3);
});

test("ven-144-166 Death Mark golden: a short deck burns as many as possible (441.4)", () => {
  const kernel = world().deck(["only"]).build();

  const outcome = resolveChainBody([burnThree], kernel);

  // A short deck is not a failure: the real count is what the receipt reports.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["death-mark.burn-3.burnedCount"], 1);
  assert.deepEqual(deckIds(kernel), []);
});

test("ven-144-166 Death Mark fail-closed: the Shadow Clone definition is refused, never substituted", () => {
  // Guards against the wrong fix: the frozen definition table has no Shadow Clone, so the
  // primitive negates with a documented blockedReason and creates nothing.
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "shadow-clone" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "shadowClone" }
    },
    { world: kernel }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked["shadowClone.amount"], 0);
  assert.deepEqual(run.linked["shadowClone.objects"], []);
  assert.equal(run.linked.shadowClone.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({}).length, 0);
});

test.todo(
  "ven-144-166 Death Mark: create the 187.11 Shadow Clone token (0 Might, domainless, with its own " +
    "attack trigger) on the Chain and hand it to the play flow (440.2.c/185.2.a) — needs the token " +
    "definition plus its ability dependency closure; effect.token deliberately excludes definitions " +
    "with additional abilities"
);

test.todo(
  "ven-144-166 Death Mark: the token's own \"When I attack, you may banish a unit from your trash. If " +
    "you do, give me [Assault 4] this turn.\" — needs the attack-declared emitter and card-program " +
    "trigger registration (RIFT-120), a Trash-unit pick, and a duration-bound keyword grant " +
    "(RIFT-81/RIFT-91)"
);

test.todo(
  "ven-144-166 Death Mark: play from Trash for the printed Flow cost (1 energy + 2 rainbow runes) and " +
    "banish the spell when it leaves the Chain by 829.1.b — needs the alternate-cost consumer " +
    "(RIFT-261) and the replacement registration path (RIFT-260)"
);
