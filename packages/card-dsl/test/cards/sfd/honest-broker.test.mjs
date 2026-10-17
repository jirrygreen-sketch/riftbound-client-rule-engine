import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/honest-broker.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1289ecc082dc4dbd1ce937e07ccee8fcc9cd4f5f461b7043454560af9c237716";
const [keyword, deathknell] = program.abilities;
const [chooseLocation, instruction] = deathknell.body;
const TOKEN_LOCATION_ID = "honest-broker.token-location";
const LOCATION_CHOICE_KEY = `honest-broker.choose-location/location%3A${TOKEN_LOCATION_ID}`;

const brokerSource = () => ({
  ref: { id: "honest-broker", zoneEntryId: 1 },
  cardId: CANONICAL,
  name: "Honest Broker",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "base", player: "A" },
  might: 2,
  energy: 2,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  combatRole: null
});

function brokerKernel() {
  const kernel = world().player("A").player("B").unit("honest-broker", { might: 2 }).build();
  const bound = kernel.clone({ source: kernel.getObject("honest-broker"), sourceSnapshot: brokerSource() });
  bound.setAnswers({ [LOCATION_CHOICE_KEY]: { type: "base", player: "A" } });
  return bound;
}

function pipelineFor(kernel) {
  return new EventPipeline({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    execute: (action) => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel,
    choose: () => { throw new Error("unexpected choice"); }
  }, ["A", "B"], "A");
}

test("sfd-155-221 Honest Broker: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /Invalid effect\.token argument: entersExhausted/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.doesNotMatch(program.judgeReason, /RIFT-82|RIFT-62/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(
    program.sourceText,
    "[Deathknell] \u2014 Play a Gold gear token exhausted. (When I die, get the effect.)"
  );
});

test("sfd-155-221 Honest Broker: Deathknell keyword + object-killed trigger on self", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.kind, "triggered");
  assert.equal(deathknell.trigger.at, "object-killed");
  assert.deepEqual(deathknell.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(deathknell.optional, false);
});

test("sfd-155-221 Honest Broker: body declares one Gold token played exhausted", () => {
  assert.equal(deathknell.body.length, 2);
  // 359.2.d: the destination is the controller's Base, resolved by the merged
  // location provider and published for the linked token instruction.
  assert.equal(chooseLocation.op, "condition.value");
  assert.deepEqual(chooseLocation.locations, [{
    id: TOKEN_LOCATION_ID,
    type: "base",
    player: "controller",
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(chooseLocation.args.value, {
    kind: "location",
    value: { kind: "target-location", target: TOKEN_LOCATION_ID }
  });

  assert.equal(instruction.id, "honest-broker.play-gold-token");
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.linkedTo, "honest-broker.choose-location");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "linked-value",
    instructionId: "honest-broker.choose-location",
    key: "location"
  });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(instruction.targets, undefined);
});

test("sfd-155-221 Honest Broker boundary: the merged play mode really creates and plays a token from this card's own shape", () => {
  // The Gold definition is the blocker, not the play-mode handoff: swapping in
  // a definition the frozen table does have (187.4 mech) runs the same authored
  // argument shape through chain creation and the play action for real.
  const kernel = brokerKernel();
  const { entersExhausted, ...supportedArgs } = instruction.args;
  const args = {
    ...supportedArgs,
    token: { kind: "constant", value: "mech" }
  };
  const outcome = resolveChainBody([chooseLocation, { ...instruction, args }], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), ["executed", "executed"]);
  const created = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Mech");
  assert.deepEqual(created[0].location, { type: "base", player: "A" });
  // 185.3.a: a token carries null Energy / Power, never zero.
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  const linked = outcome.linkedValues["honest-broker.play-gold-token.goldToken"];
  assert.equal(linked.amount, 1);
  assert.equal(linked.createdAmount, 1);
  assert.equal(outcome.events.filter((event) => event.action === "create-token").length, 1);
  assert.equal(outcome.events.filter((event) => event.action === "play").length, 1);
});

test("sfd-155-221 Honest Broker boundary: the authored Gold token is negated with the definition blocker", () => {
  const kernel = brokerKernel();
  // Drop only the unsupported entry-stipulation field covered by the next test,
  // so this scenario observes the definition blocker itself.
  const { entersExhausted, ...supportedArgs } = instruction.args;
  const outcome = resolveChainBody([chooseLocation, { ...instruction, args: supportedArgs }], kernel);

  // The authored arguments are accepted (play mode + Base destination); the
  // frozen definition table then negates the Gold creation.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["honest-broker.choose-location", "executed", undefined],
      ["honest-broker.play-gold-token", "negated", "impossible"]
    ]
  );
  assert.equal(
    outcome.linkedValues["honest-broker.play-gold-token.goldToken"].blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  const created = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.length, 0);
});

test("sfd-155-221 Honest Broker boundary: the entry-state stipulation is not an effect.token argument", () => {
  // 184.1 / 185.2.d: "exhausted" is a creation/entry stipulation. The merged
  // primitive has no entry override — its schema rejects the extra argument
  // rather than silently ignoring it (143.4: a later exhaust is not equivalent).
  const kernel = brokerKernel();
  assert.throws(
    () => resolveChainBody([chooseLocation, instruction], kernel),
    (error) => /Invalid effect\.token argument: entersExhausted/.test(String(error.message))
  );
  assert.equal(kernel.query({ zone: "board" }).filter((object) => object.isToken).length, 0);
});

test("sfd-155-221 Honest Broker: the object-killed trigger and the Deathknell expansion both register in a real pipeline", () => {
  // The subscription path itself is merged: the authored trigger and the
  // keyword expansion both register. Execution is blocked by the missing Gold
  // definition and the unregistered trigger.leave opcode, not by subscription.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = brokerKernel();
  const pipeline = pipelineFor(kernel);
  const source = { ...kernel.getObject("honest-broker"), cardId: CANONICAL };
  const ids = binding.registerProgramTriggers({ pipeline }, source);

  assert.equal(ids.length, 2);
  assert.equal(pipeline.triggers.size, 2);
  const specs = [...pipeline.triggers.values()].map((registration) => registration.spec);
  assert.deepEqual(specs.map((spec) => spec.at), ["object-killed", "object-killed"]);
  // Both abilities register. The translator keeps only the source-object anchor
  // and drops `cause`/`destination`, which stays equivalent because the closed
  // timing point itself is the kill observation (events/action-adapter.ts maps
  // the `kill` action onto `object-killed` and nothing else emits it).
  assert.deepEqual(specs[0].filter, { object: { objectId: "honest-broker" }, event: "object-killed" });
  assert.deepEqual(specs[1].filter, { object: { objectId: "honest-broker" }, event: "object-killed" });
  // 808.1.d: the Deathknell expansion's own body is the unregistered primitive,
  // so the keyword half cannot execute even though it subscribes.
  const deathknellAbility = keywordDefinitionsById.get("Deathknell").expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(deathknellAbility[0].body.map((body) => body.op), ["trigger.leave"]);
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
});

test.todo(
  "sfd-155-221 Honest Broker: resolve the Deathknell [Effect] through the real chain once the " +
    "Gold gear definition (CR 187.5), chain creation + cost-waived play (440.2.c / 185.2.a) and the " +
    "exhausted entry stipulation (184.1 / 185.2.d) exist"
);

