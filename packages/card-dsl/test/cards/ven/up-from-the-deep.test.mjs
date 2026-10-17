import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/up-from-the-deep.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-27f697d8384808a5cf80e06751e46fc43cf1638403edee35321de02b26e3af2e";
const SOURCE_TEXT =
  "Play two 1 :rb_might: Tentacle unit tokens from Bilgewater.\n" +
  "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [playTentacles] = play.body;

test("ven-100-166 Up from the Deep: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-100-166 Up from the Deep: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-100-166 Up from the Deep: judgeReason names the dynamic destination and the Flow gaps", () => {
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /Flow/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9|RIFT-260|RIFT-261/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-100-166 Up from the Deep: [Flow] keyword, printed 3 Energy cost and one token instruction", () => {
  assert.equal(program.abilities.length, 2);
  // 829.1.a: Flow is a passive keyword present on Spells; only the identity is
  // declared (README section 5).
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });

  assert.equal(play.kind, "play");
  // Printed base cost 3 Energy; the catalog's power is null (no printed Power),
  // which is never rewritten as 0 (README section 2).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["up-from-the-deep.play-tentacles", "effect.token"]
  ]);

  // CR 187.10 / 440.2.c / 185.2.a: two 1-Might Bilgewater Tentacle unit tokens,
  // each created on the Chain and handed to the play flow.
  assert.deepEqual(playTentacles.args.token, { kind: "constant", value: "tentacle" });
  assert.deepEqual(playTentacles.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(playTentacles.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playTentacles.args.choiceId, {
    kind: "constant",
    value: "up-from-the-deep.location"
  });
  assert.equal(playTentacles.linkedTo, undefined);
  assert.equal(playTentacles.targets, undefined);
  assert.equal(playTentacles.picks, undefined);
});

test("ven-100-166 Up from the Deep: the base destination is concrete, the battlefield set is not", () => {
  const locations = playTentacles.args.locations.value;
  assert.equal(locations.length, 2);
  // 355.2.a: the controller's Base is a concrete legal LocationRef for a played
  // unit; it is executed in the golden below.
  assert.deepEqual(locations[0], { type: "base", player: "controller" });
  // "a battlefield the controller controls" depends on battlefield control at
  // play time; effect.token's locations list only accepts concrete
  // LocationRefs, so the entry is a descriptive query descriptor (judgeReason)
  // and is never evaluated as if it were a location.
  assert.deepEqual(locations[1], {
    kind: "query",
    filter: { type: "battlefield", controller: "self" }
  });
});

test("ven-100-166 Up from the Deep golden: two 1-Might Bilgewater Tentacles are played to the Base", () => {
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 }).build();
  const base = { type: "base", player: "A" };
  // The caller supplies the concrete destination the card's base half names; the
  // battlefield half stays blocked (judgeReason).
  const run = runInstruction(
    token,
    {
      token: playTentacles.args.token,
      amount: playTentacles.args.amount,
      mode: playTentacles.args.mode,
      locations: { kind: "constant", value: [base] },
      choiceId: playTentacles.args.choiceId
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 2);
  assert.equal(run.linked.token.createdAmount, 2);
  const tentacles = kernel.objects.filter(object => object.isToken);
  assert.equal(tentacles.length, 2);
  for (const tentacle of tentacles) {
    // CR 187.10: a 1 Might, domainless unit token with the Bilgewater tag;
    // 185.3 keeps its Energy/Power absent (null, never 0).
    assert.equal(tentacle.name, "Tentacle");
    assert.equal(tentacle.might, 1);
    assert.deepEqual(tentacle.tags, ["Bilgewater"]);
    assert.deepEqual(tentacle.types, ["unit"]);
    assert.equal(tentacle.energy, null);
    assert.equal(tentacle.power, null);
    assert.deepEqual(tentacle.location, base);
  }
  // 440.2.c / 185.2.a: each token is created on the Chain and then played.
  assert.deepEqual(run.events.map(event => event.action), [
    "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);
});

test("ven-100-166 Up from the Deep golden: a prevented play still reports the tokens that entered", () => {
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 }).build();
  // The second play is prevented: contract 3.6 rule 2 negates the instruction
  // while the receipt reports the token that actually entered play.
  let plays = 0;
  kernel.addReplacement(action => {
    if (action.type !== "play") return null;
    plays += 1;
    return plays === 2 ? "prevented" : null;
  });
  const run = runInstruction(
    token,
    {
      token: playTentacles.args.token,
      amount: playTentacles.args.amount,
      mode: playTentacles.args.mode,
      locations: { kind: "constant", value: [{ type: "base", player: "A" }] },
      choiceId: playTentacles.args.choiceId
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.token.amount, 1);
  assert.equal(run.linked.token.createdAmount, 2);
  // One token entered the Board; the second was created but never played, so it
  // stays Pending on the Chain.
  assert.deepEqual(
    kernel.objects.filter(object => object.isToken && object.zone === "board").map(object => object.name),
    ["Tentacle"]
  );
  assert.equal(kernel.pendingItems.length, 1);
  // The replacement path records the attempt too: the second play is submitted
  // and reported prevented, and the primitive stops there (contract 3.6 rule 2).
  assert.deepEqual(run.events.map(event => event.action), [
    "create-token", "play", "create-token", "play"
  ]);
  assert.equal(run.events.at(-1).outcome, "prevented");
});

test.todo(
  "ven-100-166 Up from the Deep: offer the printed destinations (the controller's Base and the battlefields " +
    "they control) at each token's Finalize (CR 355.2 / 355.2.a) — needs a merged reader that turns the " +
    "controlled-battlefield set into concrete LocationRefs (RIFT-357 position selection) because effect.token's " +
    "locations list only accepts concrete locations"
);

test.todo(
  "ven-100-166 Up from the Deep: play this from Trash for its printed Flow cost (:rb_energy_3:) and banish it " +
    "afterwards (CR 829.1 / 829.1.b / 829.1.c.1) — needs the Flow alternate-cost and replacement consumers; " +
    "the printed Flow cost has no home in KeywordAbility (contract 3.8.3 params.cost " +
    "is not merged)"
);
