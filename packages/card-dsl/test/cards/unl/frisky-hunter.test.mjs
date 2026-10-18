import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frisky-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-3a7cc51beec4c03c4ab2831bc17b65610301b0eacb31ebfd269232c29dea5258";
const SOURCE_TEXT =
  "When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here. " +
  "(Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [ability] = program.abilities;
const [bindLocation, playBird] = ability.body;

test("unl-033-219 Frisky Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-033-219 Frisky Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Still missing: the CR 187.7 Bird definition and the production Deflect-tax
  // wiring (RIFT-90). The symbolic "here" binding itself is executable.
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /corinna-veraza/);
  assert.match(program.judgeReason, /deflectCost/);
  // The old argsSchema-symbolic-selector claim (RIFT-62) is stale: the merged
  // condition.value binding resolves "here" without touching effect.token's
  // schema, so the reason no longer cites RIFT-62 as a dependency.
  assert.ok(!/RIFT-62/.test(program.judgeReason));
});

test("unl-033-219 Frisky Hunter: card-played self trigger plays the CR 187.7 Bird token here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 2);

  // 359.3.f.1: "here" is read from the source at execution time through the
  // merged condition.value native instruction (sfd/corinna-veraza precedent).
  assert.equal(bindLocation.id, "frisky-hunter.bind-location");
  assert.equal(bindLocation.op, "condition.value");
  assert.deepEqual(bindLocation.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(bindLocation.args.key, { kind: "constant", value: "location" });

  assert.equal(playBird.id, "frisky-hunter.play-bird");
  assert.equal(playBird.op, "effect.token");
  assert.equal(playBird.linkedTo, "frisky-hunter.bind-location");
  // 187.7: the 1 [M] Bird token (domainless, Bird tag, [Deflect]).
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain first.
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  // "here" = the bound source location, consumed as a linked value (359.3.f.2).
  assert.deepEqual(playBird.args.location, {
    kind: "linked-value",
    instructionId: "frisky-hunter.bind-location",
    key: "location"
  });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "bird" });
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
});

test("unl-033-219 Frisky Hunter: the trigger registers through the merged program binding", () => {
  // RIFT-257: the card-played subscription is produced from the card program;
  // the body still cannot execute as written for the missing 187.7 definition.
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "frisky-hunter", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Frisky Hunter",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: BATTLEFIELD, might: 3, energy: 4, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  const expanded = binding.inspect(source).abilities.filter((entry) => entry.kind === "triggered");
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].trigger.at, "card-played");
  assert.equal(expanded[0].optional, false);
});

test("unl-033-219 Frisky Hunter golden: the linked 'here' binding and play-mode shape execute with a defined token", () => {
  // Proves the declared two-instruction body is the merged production shape:
  // condition.value reads the source's location at execution time (359.3.f.1)
  // and effect.token consumes it as a linked value, creating the token on the
  // Chain and then playing it (440.2.c / 185.2.a). The mech definition stands
  // in for the missing 187.7 Bird definition only as a defined-token witness.
  const kernel = world()
    .unit("frisky-hunter", { zone: "board", location: BATTLEFIELD, might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("frisky-hunter") });

  const outcome = resolveChainBody(
    [
      bindLocation,
      {
        ...playBird,
        args: { ...playBird.args, token: { kind: "constant", value: "mech" } }
      }
    ],
    context
  );

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["frisky-hunter.bind-location", "executed"],
    ["frisky-hunter.play-bird", "executed"]
  ]);
  const [created] = context.objects.filter(object => object.isToken);
  assert.equal(created.name, "Mech");
  assert.equal(created.might, 3);
  assert.deepEqual(created.tags, ["Mech"]);
  assert.deepEqual(created.types, ["unit"]);
  assert.deepEqual(created.location, BATTLEFIELD);
  assert.equal(created.controller, "A");
  assert.equal(created.owner, "A");
  // Tokens have no printed cost (185.3.a); null is never rewritten to 0.
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  // "here" was read from the source at resolution (359.3.f.1) and consumed as
  // the linked-value location (359.3.f.2).
  assert.deepEqual(outcome.linkedValues["frisky-hunter.bind-location.location"], BATTLEFIELD);
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
});

test("unl-033-219 Frisky Hunter golden: the Bird shape stays blocked until the 187.7 definition exists", () => {
  // The card's own token id must not silently resolve to a different token:
  // the definition table rejects "bird", so the production gap stays visible.
  const kernel = world()
    .unit("frisky-hunter", { zone: "board", location: BATTLEFIELD, might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("frisky-hunter") });

  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "impossible");
  // The definition table's refusal is linked under the card's own linkKey
  // ("bird") as a blocked receipt, so the 187.7 gap stays visible.
  const receipt = outcome.linkedValues["frisky-hunter.play-bird.bird"];
  assert.equal(receipt.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(receipt.amount, 0);
  assert.deepEqual(receipt.objects, []);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test.todo(
  "unl-033-219 Frisky Hunter: add the CR 187.7 1 [M] Bird unit token (domainless, Bird tag, [Deflect]) " +
    "to the effect.token definition table"
);
test.todo(
  "unl-033-219 Frisky Hunter: the Bird's [Deflect] target tax with any-domain Power payment " +
    "(CR 809.1.c.1) — target/tax/collect.ts derives and converts the tax to any-domain Power, " +
    "but the chain production path still books it as an Energy mandatory additional cost and " +
    "no merged caller feeds the taxAdapter yet (RIFT-90 follow-up)"
);
