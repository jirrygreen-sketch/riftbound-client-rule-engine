import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverageReport,
  loadGeneratedCardRegistry,
  parseJudgeReason
} from "../../dist/index.js";

test("parseJudgeReason extracts operations, keywords, timings, tasks, and rules", () => {
  assert.deepEqual(
    parseJudgeReason(
      "缺 target.player 与 trigger.delayed；依赖 RIFT-89/90，RIFT-120；CR 355.10.e；[Shield 2] at the start of your next Main Phase."
    ),
    {
      ops: ["target.player", "trigger.delayed"],
      keywords: ["shield"],
      timings: ["start-of-next-main-phase"],
      tasks: ["RIFT-120", "RIFT-89", "RIFT-90"].sort(),
      rules: ["CR 355.10.e"]
    }
  );
});

test("buildCoverageReport counts canonical identities and keeps unparseable cards manual", () => {
  const report = buildCoverageReport([
    {
      canonicalCardId: "card.hash-a",
      status: "judge-required",
      judgeReason: "缺 target.player，依赖 RIFT-90，CR 355.7",
      set: "unl"
    },
    {
      canonicalCardId: "card.hash-a",
      status: "judge-required",
      judgeReason: "缺 target.player，依赖 RIFT-90，CR 355.7",
      set: "sfd"
    },
    { canonicalCardId: "card.hash-b", status: "executable", set: "unl", cardType: "Unit" },
    { canonicalCardId: "card.hash-c", status: "no-ability", set: "unl" },
    { canonicalCardId: "card.hash-d", status: "judge-required", set: "sfd" }
  ]);

  assert.equal(report.summary.totalCanonical, 4);
  assert.deepEqual(report.summary.counts, { executable: 1, "judge-required": 2, "no-ability": 1 });
  assert.equal(report.summary.judgeRequiredWithoutParsedDependency, 1);
  assert.deepEqual(report.bySet.map(group => [group.key, group.totalCanonical]), [
    ["sfd", 1],
    ["sfd/unl", 1],
    ["unl", 2]
  ]);
  assert.deepEqual(report.byCardType.map(group => [group.key, group.totalCanonical]), [
    ["Unit", 1],
    ["unknown", 3]
  ]);
  const taskGap = report.dependencyGaps.find(gap => gap.key === "task:RIFT-90");
  assert.equal(taskGap?.canonicalCount, 1);
  assert.deepEqual(report.manualReview.canonicalCardIds, ["card.hash-d"]);
});

test("generated registry census is canonical and internally consistent", async () => {
  const loaded = await loadGeneratedCardRegistry();
  const report = buildCoverageReport(loaded.programs, loaded.source);

  const { counts, coveragePercent, executablePercentOfWithAbility, ...summaryRest } = report.summary;
  assert.equal(report.summary.totalCanonical, report.summary.counts.executable
    + report.summary.counts["judge-required"]
    + report.summary.counts["no-ability"]);
  assert.ok(Object.values(counts).every(Number.isInteger));
  assert.ok(Object.values(counts).every(value => value >= 0));
  assert.ok(coveragePercent >= 0 && coveragePercent <= 100);
  assert.ok(executablePercentOfWithAbility >= 0 && executablePercentOfWithAbility <= 100);
  assert.ok(Object.keys(summaryRest).includes("totalCanonical"));
  assert.ok(Object.keys(summaryRest).includes("judgeRequiredWithoutParsedDependency"));

  const canonicalIds = new Set(loaded.programs.map(program => program.canonicalCardId));
  assert.equal(report.summary.totalCanonical, canonicalIds.size);

  const expectedCoveragePercent = Math.round(
    (counts.executable / Math.max(report.summary.totalCanonical, 1)) * 100 * 100
  ) / 100;
  assert.equal(coveragePercent, expectedCoveragePercent);
  const withAbility = report.summary.totalCanonical - counts["no-ability"];
  const expectedAbilityCoveragePercent = Math.round(
    (counts.executable / Math.max(withAbility, 1)) * 100 * 100
  ) / 100;
  assert.equal(executablePercentOfWithAbility, expectedAbilityCoveragePercent);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.source.identity, "canonical");
  assert.equal(report.source.cardType, "registry-field-or-unknown");
  assert.equal(typeof report.source.registry, "string");
  assert.ok(report.source.registry.length > 0);
  assert.ok(Array.isArray(report.bySet));
  assert.ok(Array.isArray(report.byCardType));
  assert.ok(Array.isArray(report.dependencyGaps));
  assert.ok(report.summary.judgeRequiredWithoutParsedDependency >= 0);
  assert.equal(report.manualReview.canonicalCount, report.summary.judgeRequiredWithoutParsedDependency);
  assert.equal(report.manualReview.canonicalCardIds.length, report.manualReview.canonicalCount);
});
