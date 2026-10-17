import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/recruit-the-vanguard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-179b63953b7859f19d0affd2eb4cb2bb038eb99b560cb082a4458186f23cbc45";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Play four 1 :rb_might: Recruit unit tokens. (They can be played to your base or to battlefields you control.)";

const [speed, play] = program.abilities;
const [tokenPlay] = play.body;

test("ogs-015-024 Recruit the Vanguard: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: the reason names the missing location reading and tasks.
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-015-024 Recruit the Vanguard: [Action] keyword plus the printed 6 energy cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 }
  });
});

test("ogs-015-024 Recruit the Vanguard: one instruction plays four Recruits through the chain", () => {
  assert.equal(play.body.length, 1);
  assert.equal(tokenPlay.id, "recruit-the-vanguard.play-tokens");
  assert.equal(tokenPlay.op, "effect.token");
  // CR 187.1: the frozen recruit definition (1 Might, no printed cost).
  assert.deepEqual(tokenPlay.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(tokenPlay.args.amount, { kind: "constant", value: 4 });
  // 440.2.c / 185.2.a: a NEW token is created on the Chain and handed to play.
  assert.deepEqual(tokenPlay.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenPlay.args.choiceId, {
    kind: "constant",
    value: "recruit-the-vanguard.location"
  });
  assert.equal(tokenPlay.linkedTo, undefined);
  assert.equal(tokenPlay.targets, undefined);
  assert.equal(tokenPlay.picks, undefined);
});

test("ogs-015-024 Recruit the Vanguard: the base destination is concrete, the battlefield set is not", () => {
  const locations = tokenPlay.args.locations.value;
  assert.equal(locations.length, 2);
  // 107.1.c / 355.2.a: the controller's Base is a concrete legal LocationRef.
  assert.deepEqual(locations[0], { type: "base", player: "controller" });
  // "a battlefield you control" depends on battlefield control at play time;
  // it is recorded as a query descriptor because effect.token's locations list
  // only accepts concrete LocationRefs (see judgeReason), never faked as one.
  assert.deepEqual(locations[1], { kind: "query", filter: { type: "battlefield", controller: "self" } });
});

test("ogs-015-024 Recruit the Vanguard golden: four Recruits are played to the controller's Base", () => {
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 }).build();
  const base = { type: "base", player: "A" };
  // The caller supplies the concrete destination the card's base half names;
  // the battlefield half stays blocked (see judgeReason).
  const run = runInstruction(
    token,
    {
      token: tokenPlay.args.token,
      amount: tokenPlay.args.amount,
      mode: tokenPlay.args.mode,
      locations: { kind: "constant", value: [base] },
      choiceId: tokenPlay.args.choiceId
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 4);
  assert.equal(run.linked.token.createdAmount, 4);
  const recruits = kernel.objects.filter((object) => object.isToken);
  assert.equal(recruits.length, 4);
  for (const recruit of recruits) {
    // CR 187.1: "Recruit" is a 1 Might unit token; 185.3 keeps its cost absent.
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.types, ["unit"]);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
    assert.deepEqual(recruit.location, base);
  }
  // 440.2.c / 185.2.a: each token is created on the Chain and then played.
  assert.deepEqual(run.events.map((event) => event.action), [
    "create-token", "play", "create-token", "play", "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);
});

test("ogs-015-024 Recruit the Vanguard golden: a prevented play retains the tokens that already entered", () => {
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 }).build();
  // The third play is prevented: contract 3.6 rule 2 negates the instruction
  // while the receipt reports the tokens that actually entered play.
  kernel.addReplacement((action, context) => action.type === "play" && context.objects.filter((object) => object.isToken).length === 2 ? "prevented" : null);
  const run = runInstruction(
    token,
    {
      token: tokenPlay.args.token,
      amount: tokenPlay.args.amount,
      mode: tokenPlay.args.mode,
      locations: { kind: "constant", value: [{ type: "base", player: "A" }] },
      choiceId: tokenPlay.args.choiceId
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // Two tokens entered play and keep their identity (zoneEntryId bumped when the
  // play moved them off the chain); the third was created but never played, so
  // it is left Pending on the Chain.
  assert.equal(run.linked.token.amount, 1);
  assert.equal(run.linked.token.createdAmount, 2);
  assert.deepEqual(kernel.objects.filter((object) => object.isToken && object.zone === "board").map((object) => object.name), ["Recruit"]);
  assert.equal(kernel.pendingItems.length, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play", "create-token", "play"]);
  assert.equal(run.events.at(-1).outcome, "prevented");
});

test.todo(
  "Recruit the Vanguard battlefield destination: 'a battlefield you control' needs a merged reader that turns the " +
    "controlled-battlefield set into concrete LocationRefs (355.2) before the destination options can be offered " +
    "at Finalize — no merged surface exposes battlefield control as LocationRefs (contract change request)"
);

test.todo(
  "Recruit the Vanguard full chain play: pay 6 energy, enforce the [Action] Showdown permission, and choose the " +
    "destination during Finalize (355.2) instead of at resolution " +
    "(依赖 RIFT-89 continuous.timing 接线与 355.2 的打出位置选择)"
);
