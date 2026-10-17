import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/trove-golem.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6e0d0c7e82324687174e1c1585a9fdba369a29e517e743eb601994ed2edb5de9";
const [ability] = program.abilities;
const [instruction] = ability.body;

// The reference primitive still needs a concrete runtime LocationRef, so the
// golden substitutes the playing player's Base for the contract LocationExpr.
const { entersExhausted, ...consumedArgs } = instruction.args;
const saturatingArgs = {
  ...consumedArgs,
  location: { kind: "constant", value: { type: "base", player: "A" } }
};

test("sfd-174-221 Trove Golem: program validates, is registered and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /LocationExpr/);
  assert.equal(
    program.sourceText,
    "When you play me, play four Gold gear tokens exhausted."
  );
});

test("sfd-174-221 Trove Golem: card-played self trigger plays four Gold tokens", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "location",
    value: "ability-controller-base"
  });
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-174-221 Trove Golem golden: the card's own chain-create + play shape really plays four tokens", () => {
  // The merged chain-create + play handoff means the card's own
  // token/amount/mode/location args execute a real four-token play once the
  // definition exists. Only the Gold definition and the entry state are missing.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    { ...saturatingArgs, token: { kind: "constant", value: "mech" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // The card's own link key ("goldTokens") carries the receipt.
  assert.equal(run.linked["goldTokens.amount"], 4);
  assert.equal(run.linked["goldTokens.createdAmount"], 4);
  assert.deepEqual(
    run.events.map((event) => event.action),
    ["create-token", "play", "create-token", "play", "create-token", "play", "create-token", "play"]
  );
  const played = kernel.objects.filter((object) => object.isToken);
  assert.equal(played.length, 4);
  for (const created of played) {
    assert.deepEqual(created.location, { type: "base", player: "A" });
    assert.equal(created.controller, "A");
    assert.equal(created.energy, null);
    assert.equal(created.power, null);
  }
  // The printed "exhausted" entry state is the unsupported override recorded in
  // judgeReason, so this golden asserts only the merged chain-create + play shape
  // and leaves the entry state to the test.todo below.
});

test.todo(
  "sfd-174-221 Trove Golem: create and play four Gold gear tokens exhausted once the Gold definition " +
    "(CR 187.5) and the entry-state stipulation (184.1 / 185.2.d) are merged; the chain-create + play " +
    "handoff itself is already merged and executed above; effect.token still needs to consume the " +
    "contract LocationExpr ability-controller-base as a runtime LocationRef."
);

test.todo(
  "sfd-174-221 Trove Golem: play the created Gold tokens in the printed exhausted entry state " +
    "(184.1 / 185.2.d). The merged creation/play actions place tokens ready, and a later " +
    "effect.exhaust is not equivalent (143.4), so no execution test can assert the printed state yet."
);
