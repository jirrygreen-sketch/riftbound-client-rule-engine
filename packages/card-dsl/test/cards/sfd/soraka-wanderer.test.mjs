import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/soraka-wanderer.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import heal from "../../../../engine-core/dist/effects/instructions/effect.heal.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import {
  BlockedReplacementError,
  planReplacementBody
} from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { actionMatchesEventPattern } from "../../../../engine-core/dist/replacement/pattern.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-0d756f766acd32a10e9b167b29aabb9d0be6ef340ce4d1b8ad068ed7f9fb3d15";
const [backline, replacement] = program.abilities;
const [healInstruction, exhaustInstruction, recallInstruction] = replacement.with;

test("sfd-173-221 Soraka, Wanderer: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Backline/);
  assert.match(program.judgeReason, /recall/);
  // The refreshed reason must cite the merged replacement layer and the still
  // missing combat assignment binding / location anchors / recall action.
  assert.match(program.judgeReason, /replacement\/bind\.ts/);
  assert.match(program.judgeReason, /replacement\.object/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /linked-instruction-not-prior/);
  assert.match(program.judgeReason, /826/);
  assert.equal(
    program.sourceText,
    "I must be assigned combat damage last.\n" +
      "If another unit you control here would die, if it has less Might than me, instead heal it, " +
      "exhaust it, and recall it. (Send it to base. This isn't a move.)"
  );
});

test("sfd-173-221 Soraka, Wanderer: Backline keyword plus death replacement on another friendly unit here", () => {
  // 826.3 / 826.4.b: the assignment restriction is a Passive Ability keyword;
  // the card declares it and does not restate the combat rule.
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-killed");
  assert.equal(replacement.replaces.filter.type, "unit");
  assert.equal(replacement.replaces.filter.controller, "self");
  assert.equal(replacement.replaces.filter.other, true);
  assert.equal(replacement.replaces.filter.sameLocationAs, "self");
});

test("sfd-173-221 Soraka, Wanderer: the Might comparison and the heal/exhaust/recall body", () => {
  // "if it has less Might than me" (143.2.a): compares the replaced unit and
  // Soraka; no merged expression reads another object's Might.
  const condition = replacement.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lt");
  assert.deepEqual(condition.left, {
    kind: "object-property",
    object: { target: "soraka.dying-unit" },
    property: "might"
  });
  assert.deepEqual(condition.right, {
    kind: "object-property",
    object: "self",
    property: "might"
  });

  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args.objects, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
  assert.equal(healInstruction.targets.length, 1);
  assert.deepEqual(healInstruction.targets[0].filter, {
    type: "unit",
    controller: "controller",
    other: true,
    sameLocationAs: "self"
  });

  // 460.1 exception stated by the card: the recalled unit is exhausted.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.equal(exhaustInstruction.linkedTo, "soraka.heal-dying-unit");
  assert.deepEqual(exhaustInstruction.args.target, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });

  assert.equal(recallInstruction.op, "effect.move");
  assert.equal(recallInstruction.linkedTo, "soraka.exhaust-dying-unit");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
});

test("sfd-173-221 Soraka, Wanderer: the merged heal primitive clears the damage of the locked unit", () => {
  const kernel = world()
    .unit("soraka", { zone: "board", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { zone: "board", might: 1, damage: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("soraka") });
  const run = runInstruction(
    heal,
    {
      objects: { kind: "constant", value: { kind: "target", id: "soraka.dying-unit" } },
      linkKey: { kind: "constant", value: "healed" }
    },
    { world: scoped, targets: { "soraka.dying-unit": [scoped.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.count, 1);
  assert.deepEqual(run.linked.healed.objects, [{ id: "ally", zoneEntryId: 1 }]);
  assert.equal(scoped.getObject("ally").damage, 0);
});

test("sfd-173-221 Soraka, Wanderer: the merged recall mode refuses to approximate a Move (457-460)", () => {
  // 458: a Recall is not a Move; 458.3: it cannot be stopped by movement
  // restrictions. effect.move accepts mode "recall" but reports the blocked
  // action instead of substituting a move-location action.
  const kernel = world()
    .unit("ally", { zone: "board", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "soraka.dying-unit" } },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" },
      linkKey: { kind: "constant", value: "recalled" }
    },
    { world: kernel, targets: { "soraka.dying-unit": [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.recalled.blockedReason, "Recall requires an action distinct from Move (CR v1.5 457-460)");
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
});

test("sfd-173-221 Soraka, Wanderer: the merged Backline KeywordDef only declares the combat restriction", () => {
  // 826.3/826.4.b: the keyword expansion is a continuous.combat declaration.
  // It is the card's printed restriction, and the combat assignment step is the
  // consumer that must eventually bind it; the card itself never restates the
  // assignment rule (contract 3.7).
  const definition = keywordDefinitionsById.get("Backline");
  assert.ok(definition, "effects/keywords/Backline.ts must be registered");
  const [expansion] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.mode, "damage-assignment");
  assert.equal(expansion.effect.priority, "last");
  assert.equal(definition.stacking, "single");
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "backline" });
});

test("sfd-173-221 Soraka, Wanderer: the original with body plans linked event-object actions", () => {
  // The merged replacement layer resolves the replaced event's object through the
  // card's own { linked: "replacement.object" } selectors. The supported heal
  // and exhaust steps are planned from the shipped body itself; Recall remains
  // blocked because it needs a distinct action (CR 457-460).
  const kernel = world()
    .unit("soraka", { zone: "board", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { zone: "board", might: 1, damage: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("soraka"),
    sourceSnapshot: kernel.getObject("soraka"),
    controller: "A"
  });
  const planInput = { hostRef: kernel.ref("soraka"), replacedObject: kernel.ref("ally"), usedWindow: false };
  const planner = {
    host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context: () => bound },
    controller: "A",
    evaluate: (expr) => bound.evaluate(expr)
  };

  // 459/460: heal, then exhaust, are planned in printed order against the
  // replaced event's unit ("it").
  const planned = planReplacementBody(replacement.with.slice(0, 2), planInput, planner);
  assert.deepEqual(planned.map((action) => action.type), ["heal", "exhaust"]);
  assert.deepEqual(planned[0].object, kernel.ref("ally"));
  assert.deepEqual(planned[1].object, kernel.ref("ally"));

  // The recall step is the remaining stop: 458 says a Recall is not a Move, so
  // the planned action may never be a move-location substitute. Until a
  // distinct Recall action exists the planner must fail closed; once it lands
  // the step must plan that distinct action instead.
  let recallActions = null;
  try {
    recallActions = planReplacementBody(replacement.with.slice(2), planInput, planner);
  } catch (error) {
    assert.equal(error instanceof BlockedReplacementError, true);
    assert.match(error.message, /mode 'recall' is blocked/);
  }
  if (recallActions !== null) {
    assert.equal(recallActions.length > 0, true);
    assert.equal(recallActions.some((action) => action.type === "move-zone" || action.type === "move-location"), false);
  }
});

test("sfd-173-221 Soraka, Wanderer: production binding reaches the real Recall blocker", async () => {
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { bindReplacement } = await import("../../../../engine-core/dist/replacement/index.js");
  const f = fixture({
    cards: [{ id: "soraka", cardId: CANONICAL, types: ["unit"], energy: 4, power: ["Order"], might: 4 }]
  });
  const source = f.kernel.getObject("soraka");
  assert.throws(
    () => bindReplacement(replacement, source.ref, {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: () => f.kernel
      },
      pipeline: f.engine.pipeline
    }),
    error => {
      assert.equal(error instanceof BlockedReplacementError, true);
      assert.match(error.message, /mode 'recall' is blocked/);
      assert.equal(error instanceof RangeError, false);
      return true;
    }
  );
});

test.todo(
  "sfd-173-221 Soraka, Wanderer: execute the Backline assignment restriction in the combat damage step " +
    "(826.3 / 826.4.b; combat/base-combat-allocation.ts binds no Tank/Backline priority); the replacement " +
    "registration itself and the with-body event-object selector are merged, but Recall still needs " +
    "a distinct action (CR 457-460)"
);

test.todo(
  "sfd-173-221 Soraka, Wanderer: bind 'if it has less Might than me' to the replaced event's unit so the " +
    "merged compare/object-property evaluation can run at replacement matching time (the binding must supply " +
    "{ linked: 'replacement.object' } to the condition, and layers/engine.ts conditionMatches does not evaluate compare)"
);

// Direct evidence for the [Backline] gap: the merged keyword really binds into
// the ability layer, but no combat step consumes the declared assignment
// priority (CR 826.3/826.4.b).
test("sfd-173-221 Soraka, Wanderer: the merged layer registration carries no combat-assignment consumer", async () => {
  const { createEngineStaticBinder, expandProgram } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { engine, kernel } = fixture({ cards: [{ id: "soraka", cardId: CANONICAL, types: ["unit"], might: 4, keywords: [{ id: "Backline" }] }] });
  engine.commit({ type: "move-zone", object: kernel.ref("soraka"), to: "base", location: { type: "base", player: "A" } });
  const snapshot = kernel.getObject("soraka");
  const [backlineAbility] = expandProgram({ ...program, status: "executable", judgeReason: undefined }, snapshot).abilities
    .filter(ability => ability.kind === "static" && ability.effect.kind === "continuous.combat");
  assert.ok(backlineAbility, "the merged Backline KeywordDef must expand to continuous.combat");
  createEngineStaticBinder(engine).bindStatic(backlineAbility, snapshot);
  assert.deepEqual(engine.layers.registry.list().map(entry => entry.effect.effect.kind), ["continuous.combat"]);
  // No merged combat step reads that registration: the damage-assignment
  // service still proves "no assignment modifier was found".
  assert.equal(backlineAbility.effect.mode, "damage-assignment");
  assert.equal(backlineAbility.effect.priority, "last");
});

// Direct evidence for the location/other anchors: the production replacement
// matcher ignores the printed sameLocationAs/other keys, so a unit dying at a
// different location still matches the replacement trigger.
test("sfd-173-221 Soraka, Wanderer: the printed 'here'/'another unit' anchors do not restrict the replacement pattern", () => {
  const kernel = world()
    .unit("soraka", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("away", { might: 1, location: { type: "base", player: "A" } })
    .unit("near", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  for (const id of ["away", "near"]) {
    const object = kernel.getObject(id);
    // 370.3/370.4 + "here": only a unit dying at Soraka's location should match.
    assert.equal(actionMatchesEventPattern({
      pattern: replacement.replaces,
      action: { type: "kill", object: object.ref },
      target: { object: object.ref, player: "A" },
      hostRef: kernel.ref("soraka"),
      controller: "A",
      snapshotFor: ref => kernel.getObject(ref.id)
    }), true);
  }
  // The production filter translator rejects both anchors outright, so no
  // equivalent filter can be bound through the merged adapter either.
  assert.throws(() => translateObjectFilter({ type: "unit", other: true }), /Unsupported filter field other/);
  assert.throws(() => translateObjectFilter({ type: "unit", sameLocationAs: "self" }), /Unsupported filter field sameLocationAs/);
});

// Direct evidence for the Might comparison gap: the merged validator refuses
// the replacement event-object link as a condition operand, and the shipped
// declarative target selector has no binding at replacement match time.
test("sfd-173-221 Soraka, Wanderer: the Might comparison is unevaluable at replacement time", async () => {
  const { validateCardProgram } = await import("../../../dist/index.js");
  const linkedCondition = {
    ...replacement,
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: { linked: "replacement.object" }, property: "might" },
      operator: "lt",
      right: { kind: "object-property", object: "self", property: "might" }
    }
  };
  const rejected = validateCardProgram({
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: [program.abilities[0], linkedCondition]
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual([...new Set(rejected.issues.map(issue => issue.code))].sort(), [
    "linked-instruction-not-prior",
    "unresolved-instruction"
  ]);

  const kernel = world()
    .unit("soraka", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const bound = bindResolveContext(kernel, { source: kernel.getObject("soraka") });
  assert.throws(
    () => evaluateCondition(replacement.condition, {
      context: bound,
      host: kernel.ref("soraka"),
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false
    }),
    (error) => {
      assert.equal(error.constructor.name, "MissingInformation");
      assert.match(error.message, /Object selector has no object-valued selection/);
      return true;
    }
  );
});
