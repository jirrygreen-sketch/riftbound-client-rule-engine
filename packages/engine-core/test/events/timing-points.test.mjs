import assert from "node:assert/strict";
import test from "node:test";
import {
  TIMING_POINT_COVERAGE,
  TIMING_POINTS,
  isTimingPointId
} from "../../dist/events/index.js";

test("timing point ids are closed and unique", () => {
  const ids = TIMING_POINTS.map(point => point.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 40);
  for (const point of TIMING_POINTS) {
    assert.ok(isTimingPointId(point.id));
    assert.ok(point.descriptionZh.length > 0);
    assert.ok(point.emittedBy.length > 0);
    assert.ok(point.payloadType.length > 0);
    assert.ok(point.ruleRefs.length > 0);
    assert.equal(point.ruleRefVersion, "1.4");
  }
});

test("timing point coverage accounts for every timing point", () => {
  const covered = new Set(TIMING_POINT_COVERAGE.flatMap(segment => segment.timingPointIds));
  assert.equal(covered.size, TIMING_POINTS.length);
  for (const point of TIMING_POINTS) assert.ok(covered.has(point.id), point.id);
  for (const segment of TIMING_POINT_COVERAGE) {
    assert.ok(segment.ruleRefs.length > 0);
    assert.equal(segment.ruleRefVersion, "1.4");
    assert.ok(segment.completeness.length > 0);
  }
});

test("flow includes the named phase, chain, combat, scoring and cleanup points", () => {
  const ids = new Set(TIMING_POINTS.map(point => point.id));
  for (const id of [
    "turn-start", "awaken-start", "beginning-start", "channel-start", "draw-start", "main-start",
    "cleanup-start", "object-enters-zone", "object-leaves-zone", "card-played", "became-target",
    "attack-declared", "defense-declared", "combat-damage-before", "combat-damage-after",
    "showdown-open", "showdown-close", "chain-item-pending", "chain-item-finalize", "chain-item-resolve",
    "conquer", "hold", "score", "final-point", "turn-end"
  ]) assert.ok(ids.has(id), id);
});
