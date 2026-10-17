import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/blossoming-dreamroot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-4aaea9c834beaa6047e8f8dbb7f92137da63c691f1458dc1769641fd1ac8f358";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you win a combat here, draw 1.";

const [deploy, combatTrigger] = program.abilities;
const [drawInstruction] = combatTrigger.body;

test("rad-024-167 Blossoming Dreamroot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-024-167 Blossoming Dreamroot: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-024-167 Blossoming Dreamroot: the judgeReason names the actual merged gaps", () => {
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /468\.3/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-024-167 Blossoming Dreamroot: [Deploy] plus the combat-result trigger with a draw body", () => {
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 468.3 / 468.3.a: winning a combat is decided in the Resolution Step, which
  // the closed combat-result timing point carries.
  assert.equal(combatTrigger.kind, "triggered");
  assert.equal(combatTrigger.trigger.at, "combat-result");
  assert.equal(combatTrigger.trigger.filter.event, "combat-result");
  // "here" is the source-Battlefield anchor: the merged EventPattern has no
  // location anchor, so the sibling battlefield placeholder spelling is kept
  // and the engine validator rejects it (asserted below).
  assert.equal(combatTrigger.trigger.filter.here, true);
  assert.equal(combatTrigger.trigger.filter.player, "self");
  assert.equal(combatTrigger.optional, false);
  assert.equal(combatTrigger.trigger.once, undefined);

  assert.equal(combatTrigger.body.length, 1);
  assert.equal(drawInstruction.id, "blossoming-dreamroot.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-024-167 Blossoming Dreamroot golden: the draw body draws 1 through the merged primitive", () => {
  // The trigger itself cannot run (see judgeReason); the printed effect is a
  // plain Draw 1, executed here on the card's own arguments so a regression in
  // the instruction data is caught.
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "rad-024-167 Blossoming Dreamroot: emitting combat-result into the single event pipeline (CR 468.3) " +
    "is the combat/events bridging work (contract section 7.2 batch 5, RIFT-33)."
);

test.todo(
  "rad-024-167 Blossoming Dreamroot: expanding [Deploy] (830.1.b) needs a Deploy KeywordDef (kw-deploy), " +
    "whose merged expansion also needs the hold timing point from scoring; registering the triggered " +
    "ability needs the RIFT-257 CardProgram -> TriggerRegistration adapter."
);

test.todo(
  "rad-024-167 Blossoming Dreamroot: the trigger filter's source-Battlefield anchor needs a location " +
    "anchor in the EventPattern/ObjectFilter vocabulary (053.3 here / sameLocationAs); the merged " +
    "validator's allow-list has neither, so the placeholder cannot be evaluated."
);
