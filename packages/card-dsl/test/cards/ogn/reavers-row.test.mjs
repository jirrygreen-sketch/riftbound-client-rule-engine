import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/reavers-row.js";
// effect.move declares Expr-typed arguments, so the body runs through the
// production chain adapter, which preserves the Expr nodes for the primitive's
// own schema validation (engine-core/src/chain/interpreter-adapter.ts).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { getTimingPoint, isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL = "card.hash-50eea6ceaf8ca3375c963141d772172c81248799d0edc1429deefe6b8b1862e0";
const HERE = { type: "battlefield", id: "battlefield-1" };
const ELSEWHERE = { type: "battlefield", id: "battlefield-2" };
const [ability] = program.abilities;
const [optional] = ability.body;
const [move] = optional.args.body.value;

/** Drop the nested TargetSpec: the reference kernel compares filters literally. */
const bodyWithoutTargets = () => [
  {
    ...optional,
    args: {
      ...optional.args,
      body: {
        ...optional.args.body,
        value: [
          (({ targets, ...rest }) => rest)(move)
        ]
      }
    }
  }
];

test("ogn-285-298 Reaver's Row: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /combat\/flow\.ts/);
  assert.equal(program.sourceText, "When you defend here, you may move a friendly unit here to base.");
});

test("ogn-285-298: defend trigger with an optional move wrapped in choice.optional", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "defense-declared",
    here: true,
    player: "controller"
  });
  // "you may": the ability is optional AND the chosen instruction lives inside
  // the choice body (contract 3.9), never a bare choice + linkedTo.
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, "reavers-row.move-opt");
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Move a friendly unit here to base?"
  });
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.args.body.value.length, 1);

  assert.equal(move.id, "reavers-row.move");
  assert.equal(move.op, "effect.move");
  assert.equal(move.linkedTo, undefined);
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "reavers-row.friendly-here" }
  });
  // An effect Move to the moved unit's own Base (CR 421/451), not a Recall.
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(move.args.amount, { kind: "constant", value: 1 });
  assert.equal(move.args.mode, undefined);

  assert.equal(move.targets.length, 1);
  const [spec] = move.targets;
  assert.equal(spec.id, "reavers-row.friendly-here");
  assert.deepEqual(spec.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: "self"
  });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogn-285-298: accepting the option moves the allied unit at the source Battlefield to its Base", () => {
  // The reference kernel is value-based, so the Finalize-locked target set is
  // supplied directly and the printed TargetSpec is dropped for execution
  // (ogn/pit-rookie.test.mjs precedent). effect.move still performs the real
  // move-location action and the interpreter still runs choice.optional.
  const kernel = world()
    .unit("pit", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { location: HERE })
    .unit("there-ally", { location: ELSEWHERE })
    .build();
  kernel.setTargets("reavers-row.friendly-here", [kernel.ref("here-ally")]);
  kernel.setAnswers({ "reavers-row.move-opt/optional": true });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("pit") });

  const ran = resolveChainBody(bodyWithoutTargets(), scoped);
  assert.equal(ran.status, "executed");
  assert.equal(ran.results[0].result.status, "executed");
  assert.deepEqual(ran.events.map(event => event.action), ["move-location"]);
  // The adapter executes against the supplied ResolveContext, so the moved
  // location is read back from that same world.
  assert.deepEqual(scoped.getObject("here-ally").location, { type: "base", player: "A" });
  assert.deepEqual(scoped.getObject("there-ally").location, ELSEWHERE);
});

test("ogn-285-298: declining the option moves nothing and skips the body", () => {
  const kernel = world()
    .unit("pit", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { location: HERE })
    .build();
  kernel.setTargets("reavers-row.friendly-here", [kernel.ref("here-ally")]);
  kernel.setAnswers({ "reavers-row.move-opt/optional": false });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("pit") });

  const ran = resolveChainBody(bodyWithoutTargets(), scoped);
  assert.equal(ran.results[0].result.status, "negated");
  assert.equal(ran.results[0].result.reason, "skipped");
  assert.deepEqual(ran.events, []);
  assert.deepEqual(scoped.getObject("here-ally").location, HERE);
});

test("ogn-285-298: the trigger names the defense-declared timing point with the here placeholder", () => {
  // 383.4.f.2: "When you defend here" is a Defend Trigger at the closed
  // defense-declared timing point. The battlefield-relative spelling has no
  // evaluable form in the closed EventPattern vocabulary yet, so the declared
  // filter carries the documented `here` placeholder (see judgeReason); the
  // golden states the declaration instead of asserting a rejection that would
  // break as soon as the vocabulary lands.
  assert.equal(isTimingPointId("defense-declared"), true);
  assert.equal(ability.trigger.filter.event, "defense-declared");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "controller");
  assert.deepEqual(getTimingPoint("defense-declared").ruleRefs, ["323.2", "383.4.f", "466.2.c"]);
});

test.todo(
  "ogn-285-298: defense-declared 由 combat/ 发出（每场战斗只检查一次，383.4.f.2.a）并进链；here 需要战场相对锚点；" +
    "Finalize 按 controller \"self\" + sameLocationAs \"self\" 在守方战场上的友方单位中锁定目标" +
    "（参考内核按字面值比较过滤器，不解析 PlayerSelector）"
);
