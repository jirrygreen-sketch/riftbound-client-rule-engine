import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  TIMING_POINT_COVERAGE,
  TIMING_POINT_RULE_SOURCE,
  TIMING_POINTS,
  getTimingPoint,
  isTimingPointId
} from "../../dist/events/index.js";
import {
  CUE_EXCEPTIONS,
  LINKED_TRIGGER_CUES,
  auditAbilityTimingCoverage,
  matchTriggerHeader
} from "./timing-point-audit.mjs";

const rules = JSON.parse(readFileSync(new URL("./v15-rule-references.json", import.meta.url)));
const snapshot = JSON.parse(readFileSync(new URL("./timing-point-survey.snapshot.json", import.meta.url)));
const surveyBytes = readFileSync(new URL("../../../../docs/plans/survey/ability-templates.json", import.meta.url));
const survey = JSON.parse(surveyBytes);
const audit = auditAbilityTimingCoverage(survey);

function assertV15Refs(entry) {
  assert.ok(entry.ruleRefs.length > 0);
  for (const reference of entry.ruleRefs) {
    assert.ok(rules.ruleIds.includes(reference), `missing PDF entry ${reference}`);
  }
}

test("timing point ids are closed and unique", () => {
  const ids = TIMING_POINTS.map(point => point.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 81);
  assert.deepEqual(ids.slice(0, snapshot.legacyIds.length), snapshot.legacyIds);
  assert.equal(snapshot.legacyIds.length, 57);
  for (const point of TIMING_POINTS) {
    assert.ok(isTimingPointId(point.id));
    assert.ok(point.descriptionZh.length > 0);
    assert.ok(point.emittedBy.length > 0);
    assert.ok(point.payloadType.length > 0);
    assertV15Refs(point);
    assert.equal(point.ruleRefVersion, "1.5");
    assert.equal(getTimingPoint(point.id), point);
  }
  for (const unknown of [undefined, null, {}, "future-point", "CARD-DRAWN", ""]) assert.equal(isTimingPointId(unknown), false);
  assert.throws(() => getTimingPoint("future-point"), /Unknown timing point/);
});

test("timing point coverage accounts for every timing point", () => {
  const covered = new Set(TIMING_POINT_COVERAGE.flatMap(segment => segment.timingPointIds));
  assert.equal(covered.size, TIMING_POINTS.length);
  for (const point of TIMING_POINTS) assert.ok(covered.has(point.id), point.id);
  for (const segment of TIMING_POINT_COVERAGE) {
    assertV15Refs(segment);
    assert.equal(segment.ruleRefVersion, "1.5");
    assert.ok(segment.completeness.length > 0);
    for (const id of segment.timingPointIds) assert.ok(isTimingPointId(id), id);
  }
  assert.equal(TIMING_POINT_COVERAGE.flatMap(segment => segment.timingPointIds).length, TIMING_POINTS.length);
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

test("references are anchored to the downloaded v1.5 PDF and survey", () => {
  assert.deepEqual(TIMING_POINT_RULE_SOURCE, rules.source);
  assert.equal(createHash("sha256").update(surveyBytes).digest("hex"), snapshot.surveySha256);
  for (const entry of [...audit.templateRows, ...CUE_EXCEPTIONS, ...LINKED_TRIGGER_CUES]) assertV15Refs(entry);
});

test("all trigger templates, including keyword macros and delayed abilities, have timing points", () => {
  assert.deepEqual(audit.missingTemplates, []);
  assert.deepEqual(audit.templateRows, snapshot.templateRows);
  for (const row of audit.templateRows) {
    assert.equal(row.identityCount, survey.templates.find(template => template.id === row.templateId).cardCount);
    assert.ok(row.timingPointIds.length > 0);
    for (const id of row.timingPointIds) assert.ok(isTimingPointId(id), id);
  }
  assert.deepEqual(audit.templateRows.find(row => row.templateId === "kw-temporary").timingPointIds, ["beginning-start"]);
  assert.deepEqual(audit.templateRows.find(row => row.templateId === "kw-hunt").timingPointIds, ["conquer", "hold"]);
});

test("every observed trigger phrase maps or has a reviewed, source-specific exception", () => {
  assert.deepEqual(audit.missingPhrases, []);
  assert.equal(audit.observations.length, snapshot.mappedObservationCount);
  assert.deepEqual(audit.exceptions.map(row => `${row.printingId}:${row.phrase}`).sort(), snapshot.exceptionKeys);
  assert.equal(audit.exceptions.length, CUE_EXCEPTIONS.length);
  assert.ok(audit.exceptions.every(row => row.reason.length > 0 && row.kind.length > 0));
  for (const row of audit.observations) for (const id of row.timingPointIds) assert.ok(isTimingPointId(id), id);
});

test("new timing points declare emitter, payload and actual trigger identity counts", () => {
  const newPoints = TIMING_POINTS.filter(point => !snapshot.legacyIds.includes(point.id));
  assert.deepEqual(newPoints.map(point => point.id), Object.keys(snapshot.newPointTriggerCounts));
  for (const point of newPoints) {
    assert.ok(["turn", "combat", "chain", "scoring", "events"].includes(point.emittedBy));
    assert.ok(point.payloadFields.length > 0, point.id);
    assert.equal(new Set(point.payloadFields).size, point.payloadFields.length, point.id);
    const identities = new Set(audit.observations.filter(row => row.timingPointIds.includes(point.id)).map(row => row.canonicalCardId));
    assert.equal(identities.size, snapshot.newPointTriggerCounts[point.id], point.id);
  }
  assert.ok(getTimingPoint("object-moved").payloadFields.includes("fromKind"));
  assert.ok(getTimingPoint("object-moved").payloadFields.includes("toKind"));
  assert.ok(getTimingPoint("object-moved").payloadFields.includes("fromLocationId"));
  assert.ok(getTimingPoint("object-moved").payloadFields.includes("toLocationId"));
});

test("actual corpus clauses distinguish damage, draw, return, combat result and combined triggers", () => {
  for (const [header, ids] of [
    ["When you play me or I attack", ["attack-declared", "card-played"]],
    ["When I become [Empowered]", ["empowered-changed"]],
    ["When you draw your second card each turn", ["card-drawn"]],
    ["When you discard one or more cards", ["card-discarded"]],
    ["When any unit takes damage this turn", ["damage-dealt"]],
    ["When a unit here is returned to a player's hand", ["object-enters-hand"]],
    ["When I win a combat", ["combat-result"]],
    ["When a combat that I was in ends", ["combat-end"]],
    ["When I conquer after an attack", ["conquer"]],
    ["When you attach an Equipment to me", ["object-attached"]],
    ["When you spend a buff", ["buff-spent"]],
    ["When you buff me", ["buff-added"]]
  ]) assert.deepEqual(matchTriggerHeader(header), ids, header);
  assert.deepEqual(matchTriggerHeader("When a unit would die"), []);
});

test("unreviewed trigger templates and phrases remain missing instead of falling back", () => {
  const unknown = auditAbilityTimingCoverage({
    templates: [{ id: "trigger-unknown", primitives: ["trigger.state"], cardCount: 1 }],
    cards: {
      unknown: {
        primaryPrintingId: "unknown", templates: ["trigger-unknown"], directPrimitives: [],
        clauses: [{ text: "When you heal a friendly unit, draw 1." }]
      }
    }
  });
  assert.deepEqual(unknown.missingTemplates.map(row => row.templateId), ["trigger-unknown"]);
  assert.deepEqual(unknown.missingPhrases.map(row => row.phrase), ["When you heal a friendly unit"]);
  const unknownReplacement = auditAbilityTimingCoverage({
    templates: [],
    cards: {
      unknown: {
        primaryPrintingId: "unknown", templates: [], directPrimitives: [],
        clauses: [{ text: "When a unit would die, recall it instead." }]
      }
    }
  });
  assert.equal(unknownReplacement.exceptions.length, 0);
  assert.equal(unknownReplacement.missingPhrases.length, 1);
});

test("v1.5 combat and scoring references point to their new sections", () => {
  for (const [id, reference] of [
    ["combat-damage-after", "467.2.d"], ["combat-result", "468.3.a"],
    ["combat-end", "468.7.b"], ["conquer", "471.1"], ["hold", "471.2"],
    ["score", "470.1"], ["points-gained", "470.2"], ["final-point", "473.1.b"]
  ]) assert.ok(getTimingPoint(id).ruleRefs.includes(reference), id);
});
