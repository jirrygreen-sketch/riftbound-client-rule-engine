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
  planReplacementBody,
  REPLACED_EVENT_LINK
} from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  // The refreshed reason must cite the merged replacement layer (RIFT-260) and
  // the still-missing combat assignment binding / recall action.
  assert.match(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /replacement\.object/);
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
    value: { kind: "target", id: "soraka.dying-unit" }
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
    value: "soraka.dying-unit"
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

test("sfd-173-221 Soraka, Wanderer: the merged replacement layer binds the event object, not the card's declarative target spelling", () => {
  // RIFT-260 (replacement/) is the registration path the card was waiting for:
  // the replaced event's object is bound as { linked: "replacement.object" }.
  // The card's with body still uses its declarative target selector, so this
  // golden executes the real planner on a body rewritten to the merged
  // event-object spelling and asserts the planned actions; it never claims the
  // shipped body is executable.
  const shipped = JSON.stringify(replacement.with);
  // The printed "it" must stay a declarative selector in the card data (never a
  // baked-in runtime ObjectRef), and the shipped body still names its referent
  // for review while the binding wiring is missing.
  assert.equal(shipped.includes("soraka.dying-unit"), true);
  assert.equal(/zoneEntryId/.test(shipped), false);

  const linked = { linked: REPLACED_EVENT_LINK };
  const rewritten = JSON.parse(
    shipped
      .replaceAll('{"kind":"target","id":"soraka.dying-unit"}', JSON.stringify(linked))
      .replaceAll('"soraka.dying-unit"', JSON.stringify(linked))
  ).map(({ targets, ...rest }) => rest);

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
  const planned = planReplacementBody(rewritten.slice(0, 2), planInput, planner);
  assert.deepEqual(planned.map((action) => action.type), ["heal", "exhaust"]);
  assert.deepEqual(planned[0].object, kernel.ref("ally"));
  assert.deepEqual(planned[1].object, kernel.ref("ally"));

  // The recall step is the remaining stop: 458 says a Recall is not a Move, so
  // the planned action may never be a move-location substitute. Until a
  // distinct Recall action exists the planner must fail closed; once it lands
  // the step must plan that distinct action instead.
  let recallActions = null;
  try {
    recallActions = planReplacementBody(rewritten.slice(2), planInput, planner);
  } catch (error) {
    assert.equal(error instanceof BlockedReplacementError, true);
    assert.match(error.message, /mode 'recall' is blocked/);
  }
  if (recallActions !== null) {
    assert.equal(recallActions.length > 0, true);
    assert.equal(recallActions.some((action) => action.type === "move-zone" || action.type === "move-location"), false);
  }
});

test.todo(
  "sfd-173-221 Soraka, Wanderer: execute the Backline assignment restriction in the combat damage step " +
    "(826.3 / 826.4.b; combat/base-combat-allocation.ts binds no Tank/Backline priority); the replacement " +
    "registration itself (RIFT-260) is merged, but the with body still needs the event-object selector " +
    "spelling and the recall action (CR 457-460)"
);

test.todo(
  "sfd-173-221 Soraka, Wanderer: bind 'if it has less Might than me' to the replaced event's unit so the " +
    "merged compare/object-property evaluation can run at replacement time (the left operand must read " +
    "{ linked: 'replacement.object' }, and layers/engine.ts conditionMatches does not evaluate compare)"
);
