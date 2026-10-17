import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/brawl.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { createLayerEngine } = await import(new URL("layers/index.js", engineCore));

const CANONICAL = "card.hash-cad809540cf272ccc60c72a21f1a6766f3fdc07a03fa01da81c97bd46c428af7";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each instance of Assault while it's an attacker.)";

const [keyword, play] = program.abilities;
const [capture, grant] = play.body;

const registrations = (kernel) => kernel.continuousEffects.map((entry) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

/** "a unit" — any controller's Board unit, locked by the caller (355.7/355.9.a.1). */
function brawlWorld(unitValues = {}) {
  const kernel = world().unit("brawl-unit", { owner: "A", zone: "board", ...unitValues }).build();
  kernel.setTargets("brawl.unit", [kernel.ref("brawl-unit")]);
  return kernel;
}

const keywordsOf = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).keywords;

test("rad-004-167 Brawl: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-004-167 Brawl: [Action] plus a targeted grant whose value is read at resolution", () => {
  assert.equal(program.abilities.length, 2);
  // [Action] is a speed keyword (CR 806 / 159.2.a) expanded by the keyword
  // registry; the card only names it.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 2);

  // "equal to its Might" (CR 807.1.c / 807.2) is the target's current Might at
  // resolution, read once through the locked target selector.
  assert.equal(capture.id, "brawl.capture-might");
  assert.equal(capture.op, "condition.value");
  assert.deepEqual(capture.args.value, {
    kind: "object-property",
    object: { target: "brawl.unit" },
    property: "might"
  });
  assert.deepEqual(capture.args.key, { kind: "constant", value: "might" });

  assert.equal(grant.id, "brawl.grant-assault");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.equal(grant.linkedTo, "brawl.capture-might");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, {
    kind: "linked-value",
    instructionId: "brawl.capture-might",
    key: "might"
  });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  // The affected unit was already named as the target: the instruction consumes
  // that finalized reference instead of re-selecting by query (355.7).
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "brawl.unit" }
  });
  assert.equal(grant.condition, undefined);
  assert.equal(grant.picks, undefined);

  assert.deepEqual(grant.targets, [
    {
      id: "brawl.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-004-167 Brawl golden: the grant locks the target's Might into the ability layer", () => {
  const kernel = brawlWorld({ might: 7 });
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["brawl.capture-might", "executed"],
      ["brawl.grant-assault", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["brawl.capture-might.might"], 7);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478.1.a: an ability-layer grant, with the resolved Assault Value snapshotted
  // into the registration (CR 807.1.c reads Might once, at resolution).
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Assault");
  assert.equal(registration.effect.effect.keywordValue, 7);
  assert.equal(registration.effect.filter.objectId, "brawl-unit");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(keywordsOf(kernel, "brawl-unit"), [{ id: "Assault", value: 7 }]);
});

test("rad-004-167 Brawl golden: the granted value stays locked when the unit's Might later changes", () => {
  // 801.3.a.2 / 807.1.c: the granted Assault Value is the Might read at the
  // moment the effect applied, not a live re-read of the unit's characteristics.
  const kernel = brawlWorld({ might: 4 });
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(keywordsOf(kernel, "brawl-unit"), [{ id: "Assault", value: 4 }]);

  // Same identity with a grown Might: the layer engine must keep reporting the
  // value that was locked at resolution.
  const grown = createLayerEngine(
    [{ ...kernel.getObject("brawl-unit"), might: 9 }],
    registrations(kernel)
  );
  assert.deepEqual(grown.evaluate(kernel.ref("brawl-unit")).keywords, [{ id: "Assault", value: 4 }]);
});

test("rad-004-167 Brawl golden: an existing Assault sums into one value (CR 807.2)", () => {
  const kernel = brawlWorld({ might: 5, keywords: [{ id: "Assault", value: 2 }] });
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  // 807.2: Assault from an additional source sums into the same single value,
  // so Assault 2 + Assault 5 reads as Assault 7 (not two separate entries).
  assert.deepEqual(keywordsOf(kernel, "brawl-unit"), [{ id: "Assault", value: 7 }]);
  assert.equal(kernel.continuousEffects.length, 2);
  assert.deepEqual(
    kernel.continuousEffects.map((entry) => entry.effect.layer),
    ["ability", "arithmetic"]
  );
});

test("rad-004-167 Brawl golden: the granted Assault expires at the turn-end timing point", () => {
  // 317.1.a: "this turn" ends at the end-of-turn timing point.
  const kernel = brawlWorld({ might: 6 });
  resolveChainBody(play.body, kernel);
  const layers = createLayerEngine(kernel.objects, registrations(kernel));
  assert.deepEqual(layers.evaluate(kernel.ref("brawl-unit")).keywords, [{ id: "Assault", value: 6 }]);

  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.deepEqual(layers.evaluate(kernel.ref("brawl-unit")).keywords, []);
});

test("rad-004-167 Brawl golden: a target that left the Board is ignored (359.3.e.6)", () => {
  const kernel = brawlWorld({ might: 4 });
  const stale = kernel.ref("brawl-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("brawl.unit", [stale]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  // The Might read has no surviving object, so the capture is ignored and the
  // linked grant follows it as an ignored linked instruction (359.3.e.14.a).
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["brawl.capture-might", "ignored"],
      ["brawl.grant-assault", "ignored"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "rad-004-167 Brawl: full chain play (3 Energy + 1 Chaos Power payment and the [Action] " +
    "showdown admission) needs the Finalize cost-plan / CardProgram binding (RIFT-261 / RIFT-257)"
);
