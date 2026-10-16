import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/downstage-dramatics.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4d7df9f6e2c06a81e7fa39857ec0cf86cac9681d94b0fd33a777ff235214dee2";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Draw 1.";

const [keyword, play] = program.abilities;
const [drawInstruction] = play.body;

test("unl-061-219 Downstage Dramatics: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-061-219 Downstage Dramatics: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /820\.1\.d\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-061-219 Downstage Dramatics: [Reaction] plus the [Repeat] additional cost declared on the play ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // 820.1.c.1: the printed Repeat cost is 2 energy, declared as the play
  // ability's additional cost (contract 3.1) — the base 2-energy printed cost
  // is bound from the catalog by the cost pipeline (356.1.c).
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "constant", value: 2 }
  });
});

test("unl-061-219 Downstage Dramatics: the body is exactly one unconditional Draw 1", () => {
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["downstage-dramatics.draw-one", "effect.draw"]]
  );
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  // No target, pick or choice: the implicit drawer is the ability controller
  // (190.6.d), which effect.draw defaults to. "Draw 1." is a single fixed draw
  // (414.3), so the instruction is not conditional or linked.
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.condition, undefined);
  assert.equal(instructionDefinitionsById.get("effect.draw"), draw);
});

test("unl-061-219 Downstage Dramatics golden: Draw 1 draws one card for the controller", () => {
  const kernel = world().deck(["top-card", "next-card"], { owner: "A" }).build();

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["downstage-dramatics.draw-one", "executed"]
  ]);
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
  assert.equal(
    outcome.linkedValues["downstage-dramatics.draw-one.drawn"],
    1
  );
  assert.equal(outcome.linkedValues["downstage-dramatics.draw-one.drawnTo"], "A");
});

test("unl-061-219 Downstage Dramatics golden: an empty Main Deck draws as many as possible, here zero (414.4)", () => {
  // 414.4: draw as many as possible and then Burn Out. Burn Out itself belongs
  // to the real kernel; the reference kernel reports the actual drawn count,
  // which must never exceed the printed amount and never invent a card.
  const kernel = world().build();

  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.equal(kernel.player("A").deckSize, 0);
});

test.todo(
  "unl-061-219 Downstage Dramatics: paying the [Repeat] 2-energy additional cost and executing Draw 1 " +
    "one extra time (CR 820.1.c.1 / 820.1.d.1 / 820.3) needs the cost-plan consumer (RIFT-89) and the " +
    "resolution-side paid-count reader (RIFT-91); the body must not be hard-coded to a second draw"
);

test.todo(
  "unl-061-219 Downstage Dramatics: [Reaction] (CR 813) needs the continuous.timing consumer and chain " +
    "canAct wiring (RIFT-85 / RIFT-91) — declared only, like the merged ogn/consult-the-past"
);
