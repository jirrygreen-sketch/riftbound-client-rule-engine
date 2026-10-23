import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/azir-ascendant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import { translateCost, translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { TRIGGER_ONCE_SCOPES } from "../../../../engine-core/dist/events/trigger-spec.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-80f8e3cfb1efb8fa92d35b79b1509e929ecc65f84dfa4f899f2dd62f6019be4e";
const SOURCE_TEXT =
  ":rb_rune_calm:: [Action] — Choose a unit you control. Move me to its location and it to my original location. " +
  "If it's equipped, you may attach one of its Equipment to me. Use only once per turn.";
const BATTLEFIELD = { type: "battlefield", id: "bf-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "bf-2" };

const [ability] = program.abilities;
const [readOrigin, readChosenLocation, moveMe, moveChosen, mayAttach] = ability.body;
const [attachEquipment] = mayAttach.args.body.value;

/**
 * The chain binds the ability host to the source, and its query wrapper normalizes
 * the controller placeholder (chain/engine.ts). The reference kernel does not, so
 * the goldens lift the same production body and bind both here instead of rewriting
 * the card data.
 */
function productionContext(kernel) {
  const query = (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === kernel.controller) return false;
      }
      return matchesObjectFilter(normalized, object);
    });
  };
  return bindResolveContext(kernel, { query });
}

/** Finalize locks instruction.targets before resolution; strip them and pre-lock the kernel. */
function withLockedTargets(body) {
  return body.map(({ targets, ...rest }) => rest);
}

const azirWorld = (equipped) => {
  const builder = world()
    .unit("azir", { might: 6, location: BATTLEFIELD })
    .unit("ally", { might: 3, location: OTHER_BATTLEFIELD });
  if (equipped) builder.unit("sword", { types: ["gear"], tags: ["Equipment"], location: OTHER_BATTLEFIELD });
  const base = builder.build();
  if (equipped) base.perform({ type: "attach", object: base.ref("sword"), host: base.ref("ally") });
  return base.clone({ sourceSnapshot: base.getObject("azir") });
};

test("sfd-050-221 Azir, Ascendant: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-050-221 Azir, Ascendant: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /activated/);
  assert.match(program.judgeReason, /translateRestriction/);
  assert.match(program.judgeReason, /once-per-turn/);
  assert.match(program.judgeReason, /usage-limit/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-050-221 Azir, Ascendant: one Calm rune activation with the printed once-per-turn restriction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 806.1.c / 377.1: the printed [Action] is the activation's speed permission,
  // expressed by the contract's `timing: "action"` field.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Calm"] }]
  });
  // "Use only once per turn" is a usage limit, not part of the effect.
  assert.deepEqual(ability.restriction, { kind: "usage-limit", scope: "once-per-turn" });
});

test("sfd-050-221 Azir, Ascendant: the chosen unit is a target and both original locations are locked first (355.4)", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "azir-ascendant.read-origin",
    "azir-ascendant.read-chosen-location",
    "azir-ascendant.move-me",
    "azir-ascendant.move-chosen",
    "azir-ascendant.may-attach-equipment"
  ]);

  // 355.5/355.7: "Choose a unit you control" names a specific object -> target.
  assert.deepEqual(readChosenLocation.targets, [
    {
      id: "azir-ascendant.chosen-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(readOrigin.args.value, { kind: "object-property", object: "self", property: "location" });
  assert.deepEqual(readOrigin.args.key, { kind: "constant", value: "origin" });
  assert.deepEqual(readChosenLocation.args.value, {
    kind: "object-property",
    object: { target: "azir-ascendant.chosen-unit" },
    property: "location"
  });
  assert.deepEqual(readChosenLocation.args.key, { kind: "constant", value: "chosenLocation" });

  // 355.4/448.3: both destinations are read from the locked locations, never from
  // the objects' post-move state.
  assert.deepEqual(moveMe.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveMe.args.to, {
    kind: "linked-value",
    instructionId: "azir-ascendant.read-chosen-location",
    key: "chosenLocation"
  });
  assert.equal(moveMe.targets, undefined);
  assert.deepEqual(moveChosen.args.objects, {
    kind: "constant",
    value: { target: "azir-ascendant.chosen-unit" }
  });
  assert.deepEqual(moveChosen.args.to, {
    kind: "linked-value",
    instructionId: "azir-ascendant.read-origin",
    key: "origin"
  });
});

test("sfd-050-221 Azir, Ascendant: the optional attach is gated on the chosen unit being equipped (818.3.b)", () => {
  // 403.1 / contract 3.9: "you may" wraps the chosen instruction in the body.
  assert.equal(mayAttach.op, "choice.optional");
  assert.deepEqual(mayAttach.args.body.value.map((instruction) => instruction.id), [
    "azir-ascendant.attach-equipment"
  ]);
  // The Equipment gate is the instruction's own condition (contract 3.4 scope).
  assert.equal(mayAttach.condition.kind, "compare");
  assert.equal(mayAttach.condition.operator, "gte");
  assert.deepEqual(mayAttach.condition.right, { kind: "constant", value: 1 });
  assert.equal(mayAttach.condition.left.kind, "count");
  // 150.1/150.5: Equipment is the gear tag; the anchor is "attached to it".
  assert.deepEqual(mayAttach.condition.left.filter, {
    type: "gear",
    tags: ["Equipment"],
    attachedTo: { target: "azir-ascendant.chosen-unit" }
  });

  // 435.1: the attached card is a resolving choice among the unit's Equipment,
  // not a new target.
  assert.equal(attachEquipment.op, "effect.attach");
  assert.deepEqual(attachEquipment.args.objects.value, {
    kind: "choose",
    id: "azir-ascendant.choose-equipment",
    filter: {
      type: "gear",
      tags: ["Equipment"],
      attachedTo: { target: "azir-ascendant.chosen-unit" }
    }
  });
  assert.deepEqual(attachEquipment.args.host, { kind: "constant", value: { kind: "source" } });
  assert.equal(attachEquipment.targets, undefined);
});

test("sfd-050-221 Azir, Ascendant golden: accepting swaps the two units and attaches an Equipment to Azir", () => {
  const kernel = azirWorld(true);
  kernel.setTargets("azir-ascendant.chosen-unit", [kernel.ref("ally")]);
  kernel.setAnswers({
    "azir-ascendant.may-attach-equipment/optional": true,
    "azir-ascendant.may-attach-equipment/azir-ascendant.attach-equipment/azir-ascendant.choose-equipment": [
      kernel.ref("sword")
    ]
  });

  const outcome = resolveChainBody(withLockedTargets(ability.body), productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["azir-ascendant.read-origin", "executed"],
    ["azir-ascendant.read-chosen-location", "executed"],
    ["azir-ascendant.move-me", "executed"],
    ["azir-ascendant.move-chosen", "executed"],
    ["azir-ascendant.attach-equipment", "executed"],
    ["azir-ascendant.may-attach-equipment", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("azir").location, OTHER_BATTLEFIELD);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("sword").attachedTo, kernel.ref("azir"));
  assert.deepEqual(outcome.linkedValues["azir-ascendant.read-origin.origin"], BATTLEFIELD);
  assert.deepEqual(outcome.linkedValues["azir-ascendant.read-chosen-location.chosenLocation"], OTHER_BATTLEFIELD);
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location", "move-location", "attach"]);
});

test("sfd-050-221 Azir, Ascendant golden: declining the attach still swaps the units", () => {
  const kernel = azirWorld(true);
  kernel.setTargets("azir-ascendant.chosen-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "azir-ascendant.may-attach-equipment/optional": false });

  const outcome = resolveChainBody(withLockedTargets(ability.body), productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.at(-1).result, { status: "negated", reason: "skipped", events: [] });
  assert.deepEqual(kernel.getObject("azir").location, OTHER_BATTLEFIELD);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
  // The declined attach leaves the Equipment on the ally.
  assert.deepEqual(kernel.getObject("sword").attachedTo, kernel.ref("ally"));
});

test("sfd-050-221 Azir, Ascendant golden: an unequipped chosen unit makes the attach gate false and asks nothing", () => {
  const kernel = azirWorld(false);
  kernel.setTargets("azir-ascendant.chosen-unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(withLockedTargets(ability.body), productionContext(kernel));

  // A skipped may-node is reported as negated/skipped, which aggregates as partial.
  assert.equal(outcome.status, "partial");
  // The condition is false, so the may-instruction is skipped without a prompt.
  assert.deepEqual(outcome.results.at(-1).result, { status: "negated", reason: "skipped", events: [] });
  assert.deepEqual(kernel.getObject("azir").location, OTHER_BATTLEFIELD);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
});

test("sfd-050-221 Azir, Ascendant golden: a mistargeted chosen unit ignores the swap and its linked moves", () => {
  const kernel = azirWorld(false);
  const stale = kernel.ref("ally");
  kernel.setTargets("azir-ascendant.chosen-unit", [stale]);
  // The chosen unit leaves the Board after Finalize but before resolution.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const outcome = resolveChainBody(withLockedTargets(ability.body), productionContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["azir-ascendant.read-origin", "executed", undefined],
    ["azir-ascendant.read-chosen-location", "ignored", "mistargeted"],
    ["azir-ascendant.move-me", "ignored", "mistargeted"],
    ["azir-ascendant.move-chosen", "ignored", "mistargeted"],
    ["azir-ascendant.may-attach-equipment", "negated", "skipped"]
  ]);
  // Nothing moved: Azir stays put and the chosen unit is in hand.
  assert.deepEqual(kernel.getObject("azir").location, BATTLEFIELD);
  assert.equal(kernel.getObject("ally").zone, "hand");
});

test.todo(
  "Azir, Ascendant: bind the usage-limit/once-per-turn restriction to a real turn usage counter at Finalize, preserving Action timing and the 1 Calm Power cost (383.3.e/806.1.c)"
);

test("Azir, Ascendant: the once-per-turn usage limit has no rules adapter, so the activation cannot be finalized", () => {
  // 377.2.b: a condition on using an Activated Ability must be true to activate.
  // The merged translator refuses the declared usage-limit restriction; the only
  // per-turn frequency mechanism in the engine is TriggerSpec.once, which counts
  // trigger registrations rather than activation uses.
  assert.throws(() => translateRestriction(ability.restriction, CARD_ID),
    error => error.code === "judge-required" && /usage-limit needs a rules adapter/.test(error.message));
  assert.ok(TRIGGER_ONCE_SCOPES.includes("per-batch"));
});


test("Azir, Ascendant: the merged activation translator and payer preserve the one Calm Power cost", () => {
  const base = world().player("A", { power: ["Calm", "Mind"] })
    .unit("azir", { might: 6, power: ["Calm"], location: BATTLEFIELD }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("azir") });
  const cost = translateCost(ability.cost, CARD_ID, "activate");
  const plan = buildCostPlan(kernel, { id: "azir.activation", cost });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Calm"] }]);
  const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.payment.power.power, [{ requirementIndex: 0, from: "Calm", amount: 1 }]);
  assert.deepEqual(run.linked.payment.actions[0].action.plan.power, ["Calm"]);
  assert.deepEqual(kernel.getObject("azir").location, BATTLEFIELD);
  assert.throws(() => translateRestriction(ability.restriction, CARD_ID),
    error => error.code === "judge-required" && /usage-limit/.test(error.message));
});
