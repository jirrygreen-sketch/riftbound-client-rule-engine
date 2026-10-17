import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/reckoners-arena.js";
import { getTimingPoint, isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL = "card.hash-9b2f53a5fb533d020caec1ce47a2615b15c80247a0a913af8105823ff903f909";
const [ability] = program.abilities;
const [activation] = ability.body;

test("ogn-286-298 Reckoner's Arena: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The remaining gaps are the 383.4.g named-trigger entry and the relative
  // scoring-location binding; hold production is covered separately below.
  assert.match(program.judgeReason, /383\.4\.g/);
  assert.equal(program.sourceText, "When you hold here, activate the conquer effects of units here.");
});

test("ogn-286-298: the hold timing point is emitted by the scoring flow (this round's re-review change)", () => {
  // 471.2 / 473.2.b: hold is the one scoring timing point the outer trigger
  // needs. The merged turn/scoring flow's scheduleScore now produces it and
  // carries the held battlefield as the details.battlefieldId payload; this
  // golden records the timing point's contract rather than executing a board.
  assert.equal(isTimingPointId("hold"), true);
  const point = getTimingPoint("hold");
  assert.equal(point.emittedBy, "scoring");
  assert.deepEqual(point.ruleRefs, ["315.2.b.2", "471.2", "473.2.b"]);
  // The battlefield-relative "here" anchor itself is still a placeholder
  // (see judgeReason item 2), so the filter below is asserted as declared.
  assert.equal(ability.trigger.filter.here, true);
});

test("ogn-286-298: hold trigger with the named conquer-effect activation shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(activation.id, "reckoners-arena.activate-conquer-effects");
  // 383.4.g.1: the named part is treated as fulfilled, other conditions are
  // still checked, and no real event is emitted (383.4.g.2).
  assert.deepEqual(activation.args.namedTrigger, { kind: "constant", value: "conquer" });
  assert.deepEqual(activation.args.checkOtherConditions, { kind: "constant", value: true });
  assert.deepEqual(activation.args.emitOriginalEvent, { kind: "constant", value: false });
  assert.deepEqual(activation.args.scope, {
    kind: "constant",
    value: { type: "unit", zone: "board", location: "here", controller: "any" }
  });
  assert.equal(activation.linkedTo, undefined);
  assert.equal(activation.targets, undefined);
});

test.todo("ogn-286-298: effect.activate-named-trigger needs the CR 383.4.g.1 internal chain entry (RIFT-120); effect.score is unrelated to activating conquer effects");
test.todo("ogn-286-298: bind the held battlefield to the trigger's here restriction through the scoring payload");

test.todo(
  "ogn-286-298: hold 已由计分流程发出（turn/flow.ts 的 scheduleScore，载荷 details.battlefieldId）；" +
    "命名触发激活入口（383.4.g.1：逐条检查 conquer effects 的其余条件、不合成真实征服事件）落地后，" +
    "把符合条件的单位 conquer 效果放进链（依赖 RIFT-120 契约变更请求 3 的内部入口）"
);
test.todo(
  "ogn-286-298: 被激活的 conquer effects 不因 383.4.g.2 之后出现真实征服而重复触发" +
    "（依赖命名触发与真实事件区分，RIFT-33）"
);
