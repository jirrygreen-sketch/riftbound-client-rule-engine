import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/unchecked-power.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a418de860e5d4f594ad26cc274c4676c980ce6ba498a515c0375e939cc6fad94";

const play = program.abilities[0];
const [exhaustFriendly, dealTwelve] = play.body;

test("Unchecked Power program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1 / README §2).
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("Unchecked Power identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "Exhaust all friendly units, then deal 12 to ALL units at battlefields.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Unchecked Power structure: a non-target exhaust set, then the described set damage", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["exhaust-friendly-units", "effect.exhaust"],
    ["deal-12-at-battlefields", "effect.damage"]
  ]);

  // "Exhaust all friendly units" is a programmatic set, so it is NOT targeted
  // (355.10.d) — it is a non-target pick, and effect.exhaust exhausts every
  // eligible member when no amount is given.
  assert.deepEqual(exhaustFriendly.args, {
    pick: { kind: "constant", value: "unchecked-power.friendly-units" }
  });
  assert.equal(exhaustFriendly.targets, undefined);
  assert.deepEqual(exhaustFriendly.picks, [
    {
      id: "unchecked-power.friendly-units",
      options: ["dynamic:friendly-units"],
      selection: "all",
      filter: { type: "unit", controller: "self" }
    }
  ]);

  // "then deal 12 to ALL units at battlefields" is the 355.10.d counter-example
  // shape: a set, and one that also names a location. It is described with the
  // unmerged query/place form and is NOT declared as a target.
  assert.deepEqual(dealTwelve.args.amount, { kind: "constant", value: 12 });
  assert.deepEqual(dealTwelve.args.target, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { type: "unit", location: "battlefield" }
    }
  });
  assert.equal(dealTwelve.targets, undefined);
  assert.equal(dealTwelve.picks, undefined);
  // The printed amount is fixed per unit: not 355.14 split damage.
  assert.equal(dealTwelve.args.divide, undefined);

  // "then" is ordering, not a result reference, so neither half is linked
  // (359.3.e.14 links references to other instructions' objects or actions).
  assert.equal(exhaustFriendly.linkedTo, undefined);
  assert.equal(dealTwelve.linkedTo, undefined);
});

test("Unchecked Power golden: the exhaust half exhausts every friendly unit and skips the rest", () => {
  const kernel = world()
    .unit("ready-one", { owner: "A" })
    .unit("ready-two", { owner: "A" })
    .unit("spent", { owner: "A", exhausted: true })
    .unit("enemy", { owner: "B" })
    .build();
  kernel.setPicks("unchecked-power.friendly-units", [
    kernel.ref("ready-one"),
    kernel.ref("ready-two"),
    kernel.ref("spent")
  ]);

  const outcome = runAbilityBody([exhaustFriendly], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["exhaust", "exhaust"]);
  assert.equal(kernel.getObject("ready-one").exhausted, true);
  assert.equal(kernel.getObject("ready-two").exhausted, true);
  // 415.1.b/c: an already exhausted unit produces no additional event.
  assert.equal(kernel.getObject("spent").exhausted, true);
  // The set is the controller's units only; the enemy unit is untouched.
  assert.equal(kernel.getObject("enemy").exhausted, false);
  assert.deepEqual(outcome.results[0].result.linkedValues.exhausted, {
    count: 2,
    objects: [kernel.ref("ready-one"), kernel.ref("ready-two")],
    alreadyExhausted: 1
  });
});

test("Unchecked Power golden: an all-spent set executes with a zero count instead of failing (CR 415.1.b/c)", () => {
  const kernel = world().unit("spent", { owner: "A", exhausted: true }).build();
  kernel.setPicks("unchecked-power.friendly-units", [kernel.ref("spent")]);

  const outcome = runAbilityBody([exhaustFriendly], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(outcome.results[0].result.linkedValues.exhausted, {
    count: 0,
    objects: [],
    alreadyExhausted: 1
  });
});

test("Unchecked Power golden: the fixed 12 is dealt to every lockable battlefield unit (CR 418.1.c)", () => {
  // The damage half's set alias is pending (see judgeReason), but the merged
  // effect.damage primitive handles the fixed amount per target with no split;
  // this run pins the amount semantics the card text requires.
  const kernel = world().unit("ours", { owner: "A" }).unit("theirs", { owner: "B" }).build();
  const locked = [kernel.ref("ours"), kernel.ref("theirs")];
  const run = runInstruction(
    damage,
    { amount: dealTwelve.args.amount, target: "units-at-battlefields" },
    { world: kernel, targets: { "units-at-battlefields": locked } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ours").damage, 12);
  assert.equal(kernel.getObject("theirs").damage, 12);
  assert.equal(run.result.linkedValues.dealt, 24);
  assert.equal(run.result.linkedValues.dealtCount, 2);
});

test.todo(
  "Unchecked Power: 'deal 12 to ALL units at battlefields' needs a set-damage form " +
    "(355.10.d/355.10.b) — either effect.damage over a resolution-time set query with a " +
    "location filter, or the target system's set requirement for multi-battlefield " +
    "locations (RIFT-9 target.location/target.many, RIFT-90)."
);

test.todo(
  "Unchecked Power: the friendly-unit set for 'all friendly units' has to be resolved " +
    "against the acting controller by the production set/query path (740.1.a/740.1.b, " +
    "chain/engine.ts#context normalizes only the literal self/opponent spellings; the " +
    "Finalize placeholder vocabulary is RIFT-90 work)."
);
