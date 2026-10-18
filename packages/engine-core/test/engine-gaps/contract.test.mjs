import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import { evaluateEventIt, evaluateRelation } from "../../dist/index.js";
import effectXp from "../../dist/effects/instructions/effect.xp.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });

const contractProgram = overrides => ({
  canonicalCardId: "test.rift-782-contract",
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  sourceText: "synthetic contract witness",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card.played",
        filter: {
          event: "card.played",
          filter: { type: "unit" },
          it: { type: "unit" },
          relations: [{ relation: "same-location", object: "it", other: "source" }]
        }
      },
      optional: false,
      body: [{
        id: "gain",
        op: "effect.xp",
        args: { amount: constant(1) },
        condition: {
          kind: "all",
          conditions: [
            { kind: "event-it", object: "it" },
            { kind: "relation", relation: "different-owner", left: "it", right: "source" }
          ]
        }
      }]
    },
    {
      kind: "play",
      cost: {
        payments: [{
          id: "wild-power",
          kind: "power",
          amount: constant(1),
          source: "universal-power",
          universal: true,
          allowedDomains: ["Fury", "Mind"],
          parameters: { printedDomain: constant("Fury") }
        }],
        parameters: { receiptMode: constant("payment") },
        receiptKey: "final-payment",
        universal: true
      },
      body: [{ id: "play", op: "effect.xp", args: { amount: constant(0) } }]
    },
    {
      kind: "keyword",
      keyword: "equip",
      params: { cost: { payments: [{ kind: "energy", amount: constant(1) }] } }
    }
  ],
  ...overrides
});

test("EffectIR accepts additive it/relation, Universal receipt, and keyword parameter contracts", () => {
  const result = validateCardProgram(contractProgram());
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("EffectIR rejects unsupported relations and malformed Universal markers", () => {
  const invalid = contractProgram({
    abilities: [{
      kind: "play",
      cost: { payments: [{ kind: "power", amount: constant(1), universal: "yes" }] },
      body: [{
        id: "bad",
        op: "effect.xp",
        args: { amount: constant(1) },
        condition: { kind: "relation", relation: "adjacent", left: "it", right: "source" }
      }]
    }]
  });
  const result = validateCardProgram(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "invalid-relation"));
  assert.ok(result.issues.some(issue => issue.code === "invalid-universal-source"));

  const invalidKeyword = contractProgram({
    abilities: [{ kind: "keyword", keyword: "equip", params: { cost: { payments: [] } } }]
  });
  const keywordResult = validateCardProgram(invalidKeyword);
  assert.equal(keywordResult.ok, false);
  assert.ok(keywordResult.issues.some(issue => issue.code === "invalid-payments"));
});

function predicateContext(kernel, event) {
  return {
    context: kernel,
    host: kernel.ref("source"),
    event,
    linked: (id, key) => {
      const value = kernel.linked(id);
      return key === undefined || value === undefined || value === null || typeof value !== "object"
        ? value
        : value[key];
    },
    canLookBack: () => true,
    isIgnored: () => false
  };
}

test("relation predicates compare authoritative event roles and fail closed when information is absent", () => {
  const kernel = world()
    .unit("source", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const source = kernel.object(kernel.ref("source"));
  const ally = kernel.object(kernel.ref("ally"));
  const enemy = kernel.object(kernel.ref("enemy"));

  assert.equal(evaluateRelation(
    { kind: "relation", relation: "same-location", left: "source", right: "it" },
    predicateContext(kernel, { source, it: ally })
  ), true);
  assert.equal(evaluateRelation(
    { kind: "relation", relation: "different-location", left: "source", right: "it" },
    predicateContext(kernel, { source, it: enemy })
  ), true);
  assert.equal(evaluateRelation(
    { kind: "relation", relation: "same-controller", left: "source", right: "it" },
    predicateContext(kernel, { source, it: ally })
  ), true);
  assert.equal(evaluateRelation(
    { kind: "relation", relation: "different-owner", left: "source", right: "it" },
    predicateContext(kernel, { source, it: enemy })
  ), true);
  assert.equal(evaluateRelation(
    { kind: "relation", relation: "another", left: "source", right: "it" },
    predicateContext(kernel, { source, it: ally })
  ), true);
  assert.equal(evaluateRelation(
    { kind: "relation", relation: "same-location", left: "source", right: "it" },
    predicateContext(kernel, { source })
  ), false);
});

test("event-it only succeeds when the event supplies an authoritative pronoun binding", () => {
  const kernel = world().unit("source").unit("it").build();
  const source = kernel.object(kernel.ref("source"));
  const it = kernel.object(kernel.ref("it"));
  assert.equal(evaluateEventIt({ kind: "event-it", object: "it" }, predicateContext(kernel, { source, it })), true);
  assert.equal(evaluateEventIt({ kind: "event-it", object: "it" }, predicateContext(kernel, { source })), false);
  assert.equal(evaluateEventIt({ kind: "event-it", object: "target" }, predicateContext(kernel, { source, it })), false);
});

test("default instruction assembly covers success, rejection, ignored target, and transactional choice rollback", () => {
  const success = world().build();
  const successful = runInstruction(effectXp, { amount: constant(2) }, { world: success });
  assert.equal(successful.result.status, "executed");
  assert.equal(success.player("A").xp, 2);

  const rejected = world().build();
  rejected.addReplacement(action => action.type === "gain-xp" ? "prevented" : null);
  const refused = runInstruction(effectXp, { amount: constant(1) }, { world: rejected });
  assert.deepEqual(refused.result, { status: "negated", reason: "skipped", events: refused.result.events });
  assert.equal(rejected.player("A").xp, 0);

  const ignored = world().unit("stale").build();
  const stale = ignored.ref("stale");
  assert.equal(ignored.perform({ type: "kill", object: stale }).status, "done");
  const ignoredRun = runInstruction(effectXp, { target: "chosen", amount: constant(1) }, {
    world: ignored,
    targets: { chosen: [stale] }
  });
  assert.deepEqual(ignoredRun.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(ignored.player("A").xp, 0);

  const multi = world().unit("ally").unit("enemy", { owner: "B" }).build();
  const before = multi.stateForTest();
  const asked = runInstruction(effectXp, {
    target: "chosen",
    amount: constant(1),
    choice: { id: "recipient" }
  }, { world: multi, targets: { chosen: [multi.ref("ally"), multi.ref("enemy")] } });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(multi.stateForTest(), before);
  const answered = runInstruction(effectXp, {
    target: "chosen",
    amount: constant(1),
    choice: { id: "recipient" }
  }, {
    world: multi,
    targets: { chosen: [multi.ref("ally"), multi.ref("enemy")] },
    answers: { recipient: "B" }
  });
  assert.equal(answered.result.status, "executed");
  assert.equal(multi.player("B").xp, 1);
});

