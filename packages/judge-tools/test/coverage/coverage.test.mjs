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

test("generated registry census is canonical and reports current status counts", async () => {
  const loaded = await loadGeneratedCardRegistry();
  const report = buildCoverageReport(loaded.programs, loaded.source);
  assert.equal(report.summary.totalCanonical, 1080);
  assert.deepEqual(report.summary.counts, { executable: 91, "judge-required": 973, "no-ability": 16 });
  assert.equal(report.summary.coveragePercent, 8.43);
  assert.equal(report.byCardType[0]?.key, "unknown");
  assert.equal(report.byCardType[0]?.totalCanonical, 1080);
  assert.equal(report.dependencyGaps[0]?.canonicalCount, 327);
});
