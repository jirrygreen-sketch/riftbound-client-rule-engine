import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/convergent-mutation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

/**
 * chain/engine.ts resolves the static controller spellings before it calls the
 * production matcher: 'self' becomes the ability controller and 'opponent'
 * excludes that player's objects. The reference kernel's own query compares
 * filter values literally, so the golden goes through the same normalization
 * the production chain applies (the merged siphon-power / switcheroo goldens
 * use this exact helper).
 */
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

const CANONICAL = "card.hash-6d70f12e2dfb5fbc2398e27f4f4f03110c0310091884499b782107d95b9d6c65";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit. This turn, increase its Might to the Might of another friendly unit.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [captureMight, setMight] = play.body;

test("Convergent Mutation program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1 / README §2): the
  // modification now has a merged path, but the reference clause's targeting
  // semantics are still unresolved.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /479\.4\.b/);
  assert.match(program.judgeReason, /裁定/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("Convergent Mutation identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Convergent Mutation structure: [Reaction], the Might capture, and the set effect", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "convergent-mutation.capture-might",
    "convergent-mutation.set-might"
  ]);

  // "increase its Might to the Might of another friendly unit" is a set
  // arithmetic effect (479.4.b uses this exact phrasing as its snapshotting
  // example); the value read is captured first and fed in as a linked value.
  assert.equal(captureMight.op, "condition.value");
  assert.deepEqual(captureMight.args.value, {
    kind: "object-property",
    object: { target: "another-friendly-unit" },
    property: "might"
  });
  assert.deepEqual(captureMight.args.key, { kind: "constant", value: "reference-might" });

  assert.equal(setMight.op, "continuous.might");
  assert.deepEqual(setMight.args.mode, { kind: "constant", value: "set" });
  assert.deepEqual(setMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setMight.args.amount, {
    kind: "linked",
    instructionId: "convergent-mutation.capture-might",
    key: "reference-might"
  });
  assert.deepEqual(setMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "chosen-unit" }
  });
});

test("Convergent Mutation structure: the chosen unit and the referenced unit are declared separately", () => {
  // Both readings of the second clause need one friendly unit as the affected
  // object and one other friendly unit as the Might reference; "another"
  // excludes the chosen unit, and neither may be the same object.
  assert.deepEqual(setMight.targets, [
    {
      id: "chosen-unit",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    },
    {
      id: "another-friendly-unit",
      filter: { type: "unit", controller: "self", other: true },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(setMight.linkedTo, undefined);
});

test("Convergent Mutation golden: the merged primitives register the captured Might as a set modification", () => {
  // The merged continuous.might primitive and the condition.value capture do
  // run through the production chain adapter; what remains unexecutable is the
  // rules reading of "another friendly unit" (see judgeReason). The golden
  // records the mechanical registration, not a claim that the card executes as
  // printed.
  const kernel = world()
    .unit("chosen", { owner: "A", might: 2 })
    .unit("reference", { owner: "A", might: 5 })
    .build();
  kernel.setTargets("chosen-unit", [kernel.ref("chosen")]);
  kernel.setTargets("another-friendly-unit", [kernel.ref("reference")]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["convergent-mutation.capture-might", "executed"],
    ["convergent-mutation.set-might", "executed"]
  ]);
  assert.equal(outcome.linkedValues["convergent-mutation.capture-might.reference-might"], 5);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "set-might");
  assert.equal(registration.effect.effect.value, 5);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const engine = createLayerEngine([kernel.getObject("chosen")], kernel.continuousEffects.map((entry, index) => ({
    ...entry,
    timestamp: index + 1
  })));
  assert.equal(engine.evaluate(kernel.ref("chosen")).might, 5);
});

test.todo(
  "Convergent Mutation: whether 'another friendly unit' is a chosen target (355.7, second Finalize " +
    "target + became-target events) or a characteristic-derived reference (355.10.d), and whether its " +
    "Might is snapshotted per 479.4.b or read live, needs a rules ruling before the card can claim " +
    "executable; the target system (RIFT-90) owns the eventual target wiring."
);

test.todo(
  "Convergent Mutation: resolving which friendly unit is referenced, whether it is " +
    "Targeted (355.7) and when the choice is made (355.3/355.5) needs a rules ruling " +
    "and the target system (RIFT-90); the source text does not state the chooser."
);

test.todo(
  "Convergent Mutation: [Reaction] admission and its three continuous.timing grants " +
    "(813.1.b) are chain + layer work (RIFT-91), not card data."
);
