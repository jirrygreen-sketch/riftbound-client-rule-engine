import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/irresistible-faefolk.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-bd638db89dd40b1e7a4af53d4b6502145b269d568f69478b4f5e9f979e6a89c3";
const SOURCE_TEXT =
  "When I move to a battlefield, you may move an enemy unit to that battlefield.";

const HERE = { type: "battlefield", id: "battlefield-1" };
const THERE = { type: "battlefield", id: "battlefield-2" };

const [ability] = program.abilities;
const [moveOption] = ability.body;
const [moveEnemy] = moveOption.args.body.value;

/**
 * The reference kernel compares filters literally (it does not resolve the
 * ability-controller selector), so the Finalize-locked target set is supplied
 * directly and the printed TargetSpec is dropped for execution — the
 * ogn/reavers-row and ogn/pit-rookie precedent. Only the optional wrapper's
 * decision and the choice body's shape are exercised through this helper.
 */
const bodyWithLockedTargets = () => [
  {
    ...moveOption,
    args: {
      ...moveOption.args,
      body: {
        ...moveOption.args.body,
        value: [(({ targets, ...rest }) => rest)(moveEnemy)]
      }
    }
  }
];

/**
 * chain/engine.ts resolves the static controller spellings before it calls the
 * production matcher: "self"/"controller" bind to the ability controller and
 * "opponent" excludes that player's objects. The reference kernel's own query
 * compares filter values literally, so the destination golden goes through the
 * same normalization the production chain applies.
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = controller;
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

test("unl-112-219 Irresistible Faefolk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-112-219 Irresistible Faefolk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /449\.2/);
  assert.match(program.judgeReason, /action-adapter/);
  assert.match(program.judgeReason, /RIFT-120/);
  // The program binding is merged, so the reason must name the closed event
  // vocabulary and the retained anchor rather than a missing adapter.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /RIFT-270/);
});

test("unl-112-219 Irresistible Faefolk: 'When I move to a battlefield' keeps the Destination gate as a placeholder", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  // 449.2: the Destination kind must be a Battlefield; the event payload is not
  // populated, so `movedToBattlefield` records the gap (volibear-imposing's
  // movedToOtherThanSourceLocation is the documented precedent).
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { object: "self", movedToBattlefield: true }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("unl-112-219 Irresistible Faefolk: 'you may' wraps the move in choice.optional (contract 3.9)", () => {
  assert.equal(ability.optional, true);
  assert.equal(moveOption.id, "irresistible-faefolk.move-opt");
  assert.equal(moveOption.op, "choice.optional");
  assert.deepEqual(moveOption.args.prompt, {
    kind: "constant",
    value: "Move an enemy unit to that battlefield?"
  });
  assert.equal(moveOption.linkedTo, undefined);
  assert.equal(moveOption.args.body.value.length, 1);
  assert.equal(moveEnemy.linkedTo, undefined);
});

test("unl-112-219 Irresistible Faefolk: the destination is read from the source's current location", () => {
  assert.equal(moveEnemy.id, "irresistible-faefolk.move-enemy");
  assert.equal(moveEnemy.op, "effect.move");
  assert.deepEqual(moveEnemy.args.objects, {
    kind: "constant",
    value: { target: "irresistible-faefolk.enemy-unit" }
  });
  // “that battlefield” = the Destination of the triggering Move = the source's
  // current location, read at resolution through the contract 3.2
  // object-property expression (royal-guard precedent), never a hard-coded id.
  assert.deepEqual(moveEnemy.args.to, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(moveEnemy.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveEnemy.args.mode, undefined);
  assert.equal(moveEnemy.targets.length, 1);
  const [spec] = moveEnemy.targets;
  assert.equal(spec.id, "irresistible-faefolk.enemy-unit");
  // 355.5 / 355.7: the enemy unit is chosen by the ability's controller, so it
  // is a target; "an enemy unit" carries no location restriction of its own.
  assert.deepEqual(spec.filter, { type: "unit", zone: "board", controller: "opponent" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("unl-112-219 Irresistible Faefolk golden: declining moves nothing", () => {
  const kernel = world()
    .unit("irresistible-faefolk", { controller: "A", location: HERE })
    .unit("enemy-unit", { controller: "B", location: THERE })
    .build();
  kernel.setTargets("irresistible-faefolk.enemy-unit", [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "irresistible-faefolk.move-opt/optional": false });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("irresistible-faefolk") });

  const outcome = runAbilityBody(bodyWithLockedTargets(), context);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(context.events, []);
  assert.deepEqual(context.getObject("enemy-unit").location, THERE);
});

test("unl-112-219 Irresistible Faefolk: the merged effect.move schema rejects the symbolic destination selector", () => {
  // Evidence for judgeReason item 3: contract 3.6 says the interpreter binds
  // ObjectSelector to a runtime ObjectRef, but effect.move's own isExpr still
  // demands a runtime ObjectRef inside object-property, so the declared
  // instruction fails closed before execution.
  assert.throws(
    () =>
      move.argsSchema.parse({
        objects: moveEnemy.args.objects,
        to: moveEnemy.args.to,
        amount: moveEnemy.args.amount
      }),
    /effect\.move requires a to Expr/
  );
});

test("unl-112-219 Irresistible Faefolk: the trigger filter's Destination gate is not consumed by the merged matcher", async () => {
  // Evidence for judgeReason item 1: the merged trigger matcher reads object
  // characteristics and event fields; `movedToBattlefield` is a placeholder and
  // the declared object-moved payload (toKind / toLocationId) is not populated.
  const { validateTriggerSpec } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  const result = validateTriggerSpec(ability.trigger);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(issue => issue.code === "unknown-field"),
    "the placeholder key is not part of the frozen EventPattern/Obfilter vocabulary"
  );
});

test("unl-112-219 Irresistible Faefolk: the object-moved subscription fails closed in the merged program binding", async () => {
  // Evidence for judgeReason item 1: the program-side translator rejects the
  // retained movedToBattlefield placeholder before the closed event vocabulary
  // is even consulted, so no production subscription is installed.
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "irresistible-faefolk"),
    error => error.code === "judge-required" && /Unsupported filter field movedToBattlefield/.test(error.message)
  );
  // The plain object-moved spelling is outside the closed vocabulary too.
  const { validateTriggerSpec } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  const result = validateTriggerSpec({ at: "object-moved", filter: { event: "object-moved", object: { objectId: "irresistible-faefolk" } } });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, "invalid-event-type");
});

test("unl-112-219 Irresistible Faefolk golden: the printed destination is read and executed with the merged read-then-move shape", async () => {
  // 449.2 / 359.3.f: "that battlefield" is the source's current location, read
  // when the ability resolves. The merged idiom is condition.value + a
  // linked-value destination (the sfd/azir-sovereign and sfd/fae-porter
  // precedent), and the golden proves the move really happens with the card's
  // own object selection (objects: { target: "<TargetSpec id>" }).
  const { resolveChainBody } = await import("../../../../engine-core/dist/chain/interpreter-adapter.js");
  const kernel = world()
    .unit("irresistible-faefolk", { owner: "A", controller: "A", location: HERE })
    .unit("enemy-unit", { owner: "B", controller: "B", location: THERE })
    .build();
  const base = kernel.clone({ sourceSnapshot: kernel.getObject("irresistible-faefolk"), controller: "A" });
  base.setTargets("irresistible-faefolk.enemy-unit", [kernel.ref("enemy-unit")]);
  const context = chainContext(base, "A");
  context.setTargets("irresistible-faefolk.enemy-unit", [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody([
    {
      id: "irresistible-faefolk.read-destination",
      op: "condition.value",
      args: {
        value: { kind: "object-property", object: "source", property: "location" },
        key: { kind: "constant", value: "here" }
      }
    },
    {
      ...moveEnemy,
      linkedTo: "irresistible-faefolk.read-destination",
      args: {
        ...moveEnemy.args,
        to: {
          kind: "linked-value",
          instructionId: "irresistible-faefolk.read-destination",
          key: "here"
        }
      }
    }
  ], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["irresistible-faefolk.read-destination", "executed"],
    ["irresistible-faefolk.move-enemy", "executed"]
  ]);
  // 421.1 / 449.2: the enemy unit really moved to the source's battlefield.
  assert.deepEqual(base.getObject("enemy-unit").location, HERE);
  assert.deepEqual(outcome.linkedValues["irresistible-faefolk.read-destination.here"], HERE);
  assert.deepEqual(outcome.linkedValues["irresistible-faefolk.move-enemy.moved"].movements, [
    { object: { id: "enemy-unit", zoneEntryId: 1 }, from: THERE, to: HERE }
  ]);
});

test.todo(
  "unl-112-219 Irresistible Faefolk: populate the object-moved payload (fromKind / toKind / fromLocationId / toLocationId) and match 'to a battlefield' against the Destination (449.2) — events/action-adapter.ts emits the timing point without those fields (RIFT-270 audit) and the closed EVENT_PATTERN_TYPES has no object-moved spelling"
);
test.todo(
  "unl-112-219 Irresistible Faefolk: register the object-moved triggered ability as a TriggerRegistration and resolve the {object: \"self\"} anchor in production — programs/triggers.ts exists (RIFT-257) but both the placeholder filter and the event spelling fail closed"
);
