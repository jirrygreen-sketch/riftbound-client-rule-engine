import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/last-stand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { createLayerEngine } = await import(new URL("layers/index.js", engineCore));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", engineCore));

const CARD_ID = "card.hash-cfe83e821b0faa83120c2096c34d250fad91786b0aba091191591e6936237f0a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Double a friendly unit's Might this turn. Give it [Temporary]. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [actionKeyword, play] = program.abilities;
const [captureMight, doubleMight, giveTemporary] = play.body;

// chain/engine.ts resolves the static controller/owner spellings before it
// calls the production matcher (the merged Siphon Power / Smoke Screen goldens
// use this same helper).
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};
const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

/** The keyword ids on a layered snapshot, ignoring the optional value slot. */
const keywordIds = (snapshot) => snapshot.keywords.map(keyword => keyword.id);

test("ogn-069-298 Last Stand: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-069-298 Last Stand identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-069-298 Last Stand judgeReason names the registered halves and the remaining binding gap", () => {
  assert.match(program.judgeReason, /433\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /816/);
  assert.match(program.judgeReason, /RIFT-265/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ogn-069-298 Last Stand structure: [Action] keyword plus doubling then a linked Temporary grant", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "last-stand.capture-might",
    "last-stand.double-might",
    "last-stand.give-temporary"
  ]);

  // 433.1/433.1.a: the doubling amount is the target's Might read at
  // resolution; condition.value publishes it as a named binding.
  assert.equal(captureMight.op, "condition.value");
  assert.deepEqual(captureMight.args.value, {
    kind: "object-property",
    object: { target: "last-stand.unit" },
    property: "might"
  });
  assert.deepEqual(captureMight.targets, [
    {
      id: "last-stand.unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // The modification re-reads the captured value and lasts for the turn.
  assert.equal(doubleMight.op, "continuous.might");
  assert.equal(doubleMight.linkedTo, "last-stand.capture-might");
  assert.deepEqual(doubleMight.args.amount, {
    kind: "linked-value",
    instructionId: "last-stand.capture-might",
    key: "doubled"
  });
  assert.deepEqual(doubleMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(doubleMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "last-stand.unit" }
  });

  // "Give it [Temporary]" — the same unit, so the grant is linked to the
  // target choice (359.3.e.14) and names the CR 816 keyword.
  assert.equal(giveTemporary.op, "continuous.grant-keyword");
  assert.equal(giveTemporary.linkedTo, "last-stand.capture-might");
  assert.deepEqual(giveTemporary.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(giveTemporary.args.objects, doubleMight.args.objects);
});

test("ogn-069-298 Last Stand golden: both instructions execute through the production chain adapter", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("last-stand.unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["last-stand.capture-might", "executed"],
    ["last-stand.double-might", "executed"],
    ["last-stand.give-temporary", "executed"]
  ]);

  // 433.1: the 3-Might unit's arithmetic-layer registration equals its current
  // Might, giving 6 effective Might; the grant carries the Temporary keyword.
  assert.equal(kernel.continuousEffects.length, 2);
  const layers = createLayerEngine(kernel.objects, registrations(kernel));
  const evaluated = layers.evaluate(kernel.ref("ally"));
  assert.equal(evaluated.might, 6);
  assert.deepEqual(keywordIds(evaluated), ["Temporary"]);

  // 317.2.c / 468.7.c: only the this-turn Might change expires; the granted
  // keyword is the permanent ability-layer grant.
  const expired = layers.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 3);
  assert.deepEqual(keywordIds(layers.evaluate(kernel.ref("ally"))), ["Temporary"]);
});

test("ogn-069-298 Last Stand golden: a target lost before resolution ignores every clause (359.3.e.14)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("last-stand.unit", [stale]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["last-stand.capture-might", "ignored"],
    ["last-stand.double-might", "ignored"],
    ["last-stand.give-temporary", "ignored"]
  ]);
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "Last Stand: granting [Temporary] (816.1.b: kill this at the start of its controller's Beginning Phase, " +
    "before scoring) needs the RIFT-257 card keyword-to-trigger binding so the merged Temporary KeywordDef " +
    "(RIFT-265) expansion actually subscribes to beginning-start; 816.2 makes multiple instances redundant and " +
    "124.1 clears temporary modifications on zone change"
);

test.todo(
  "Last Stand: [Action] admission (806.1.b) and the linked-target re-verification for both instructions " +
    "(355.8/359.3.e.14) belong to the chain and target batches (RIFT-90/RIFT-120)"
);
