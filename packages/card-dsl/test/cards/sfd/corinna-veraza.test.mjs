import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/corinna-veraza.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-501f79047db4a7b99900a5e5d9ccc837a75c7d22b74a2584683a55e48a288d95";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const BASE = { type: "base", player: "A" };
const READ_ID = "corinna-veraza.read-here";
const PLAY_ID = "corinna-veraza.play-recruits";

const body = () => program.abilities[1].body;

const boundWorld = (kernel) => kernel.clone({
  source: kernel.ref("corinna"),
  sourceSnapshot: kernel.getObject("corinna")
});

test("sfd-179-221 Corinna Veraza: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-179-221 Corinna Veraza: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /toZone/);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /Additional costs are not bound/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
      "When I move to a battlefield, play three 1 :rb_might: Recruit unit tokens here."
  );
});

test("sfd-179-221 Corinna Veraza: Accelerate keyword plus a move-triggered token body", () => {
  assert.equal(program.abilities.length, 2);
  const [accelerate, triggered] = program.abilities;
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  // "When I move" is the object-moved timing point (421.1 / 449.1, 458 excludes Recalls);
  // "to a battlefield" adds the destination filter.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
});

test("sfd-179-221 Corinna Veraza: the body reads \"here\" then plays three Recruit tokens there", () => {
  assert.deepEqual(body().map((instruction) => [instruction.id, instruction.op]), [
    [READ_ID, "condition.value"],
    [PLAY_ID, "effect.token"]
  ]);

  // "here" is a referent read from the source at resolution time (359.3.f.1/.2);
  // static IR cannot carry a runtime ObjectRef, so the read is linked forward.
  const [read, playTokens] = body();
  assert.deepEqual(read.args.value, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(playTokens.linkedTo, READ_ID);
  // CR 187.1: a 1 Might domainless Recruit unit token — the merged effect.token
  // definition id "recruit"; played per 440.2.c/185.2.a, three printed times.
  assert.deepEqual(playTokens.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playTokens.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(playTokens.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playTokens.args.location, { kind: "linked-value", instructionId: READ_ID, key: "here" });
  assert.equal(playTokens.targets, undefined);
  assert.equal(playTokens.picks, undefined);
});

test("sfd-179-221 Corinna Veraza: the body plays three 1 Might Recruit unit tokens at the source battlefield", () => {
  const kernel = boundWorld(world().unit("corinna", { might: 6, location: BATTLEFIELD }).build());
  assert.deepEqual(kernel.getObject("corinna").location, BATTLEFIELD);

  const outcome = resolveChainBody(body(), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    [READ_ID, "executed"],
    [PLAY_ID, "executed"]
  ]);

  const recruits = kernel.objects.filter((object) => object.isToken);
  assert.equal(recruits.length, 3);
  for (const recruit of recruits) {
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.types, ["unit"]);
    assert.deepEqual(recruit.location, BATTLEFIELD);
    assert.equal(recruit.owner, "A");
    assert.equal(recruit.controller, "A");
    // Tokens have no printed cost (185.3); null is never rewritten to 0.
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
  }

  const playResult = outcome.results.find((result) => result.id === PLAY_ID);
  assert.deepEqual(playResult.result.linkedValues["token.objects"], recruits.map((recruit) => recruit.ref));
  assert.equal(playResult.result.linkedValues["token.amount"], 3);
  assert.equal(playResult.result.linkedValues["token.createdAmount"], 3);
  // Each token is created on the Chain and then played (440.2.c / 185.2.a), so
  // the action log interleaves create-token and play and leaves no pending item.
  assert.deepEqual(kernel.events.map((event) => event.action), [
    "create-token", "play", "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);
});

test("sfd-179-221 Corinna Veraza: \"here\" is read at resolution, so a source back at base plays the tokens there", () => {
  const kernel = boundWorld(world().unit("corinna", { might: 6, location: BASE }).build());
  const outcome = resolveChainBody(body(), kernel);
  assert.equal(outcome.status, "executed");
  const recruits = kernel.objects.filter((object) => object.isToken);
  assert.equal(recruits.length, 3);
  for (const recruit of recruits) assert.deepEqual(recruit.location, BASE);
});

test.todo(
  "sfd-179-221 Corinna Veraza: object-moved must become a registrable EVENT_PATTERN_TYPE and the " +
    "move-location emission must carry the Move's origin/destination payload " +
    "(fromKind/fromLocationId/toKind/toLocationId, timing-points.ts) plus the moved object, so the " +
    "toZone: \"battlefield\" + source-self trigger can be evaluated."
);
test.todo(
  "sfd-179-221 Corinna Veraza: paying the optional Accelerate cost [1][Order] and the enter-ready replacement " +
    "run through the play translateCost and the cost plan's optionalAdditional consumer; play.ts currently " +
    "throws judgeRequired (\"Additional costs are not bound\") and static accelerate.cost has no Finalize " +
    "consumer (805)."
);
