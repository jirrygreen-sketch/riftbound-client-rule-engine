import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/buff.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-66eaa3ba7dcb5f48286af9287931a07e8311549ec5b0d9c312fce567f2d723b1";
const SOURCE_TEXT = "A unit may have no more than one buff at a time.";

test("unl-t04 Buff: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-t04 Buff: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The printed text is a statement of the shared 427.1.b.1 / 702.3 rule, not a
  // no-ability card: the reminder is reported as judge-required with a concrete
  // reason instead of claiming the card face has no ability text.
  assert.equal(program.judgeReason.includes("702.3"), true);
  assert.equal(program.judgeReason.includes("no-ability"), true);
  assert.deepEqual(program.abilities, []);
});

test("unl-t04 Buff golden: the merged effect.buff already enforces the printed one-buff limit", () => {
  // 427.1.b.1 / 702.3 / 702.3.a: placing a second Buff is a no-op, which is the
  // rule the token's text restates — it is implemented in the engine, not here.
  const kernel = world()
    .unit("target", { buffs: 0 })
    .build();
  kernel.setTargets("buff-target", [kernel.ref("target")]);
  const first = runInstruction(buff, { mode: "buff", target: "buff-target" }, { world: kernel });
  assert.equal(first.result.status, "executed");
  assert.equal(first.linked.buffedCount, 1);
  assert.equal(kernel.getObject("target").buffs, 1);

  const second = runInstruction(buff, { mode: "buff", target: "buff-target" }, { world: kernel });
  // 702.3.a: the unit keeps exactly one Buff; nothing new is placed.
  assert.deepEqual(second.result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("target").buffs, 1);
});

test("unl-t04 Buff golden: each Buff still contributes exactly +1 Might (703), so the cap is one", () => {
  // The card restates the cap, not the +1: 703 stays the layers system's job. The
  // merged primitive tracks the counter; the reference kernel stores it verbatim.
  const kernel = world().unit("target", { buffs: 0 }).build();
  kernel.setTargets("buff-target", [kernel.ref("target")]);
  runInstruction(buff, { mode: "buff", target: "buff-target" }, { world: kernel });
  assert.equal(kernel.getObject("target").buffs, 1);
  // A spend removes that single counter (702.2.b).
  const spend = runInstruction(buff, { mode: "spend", target: "buff-target" }, { world: kernel });
  assert.equal(spend.result.status, "executed");
  assert.equal(kernel.getObject("target").buffs, 0);
});
