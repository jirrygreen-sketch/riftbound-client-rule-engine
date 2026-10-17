import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/downstage-dramatics.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { abilitySpeed, expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /paid-instance count/);
  assert.doesNotMatch(program.judgeReason, /RIFT-85|RIFT-89|RIFT-91|RIFT-120|RIFT-257/);
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

test("unl-061-219 Downstage Dramatics: the merged Reaction keyword expands and derives reaction speed", () => {
  const source = {
    ref: { id: "downstage", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Downstage Dramatics",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: null,
    energy: 2,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = expandProgram(program, source);
  const timingGrant = expanded.expanded.find(
    (ability) => ability.kind === "static" && ability.effect.kind === "continuous.timing"
  );
  assert.ok(timingGrant);
  assert.deepEqual(timingGrant.effect.grants, ["showdown", "closed-state"]);
  assert.equal(abilitySpeed(expanded.abilities, source), "reaction");
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

test("unl-061-219 Downstage Dramatics boundary: the Repeat cost has no Finalize binding on either declaration path (CR 820.1.c.1)", () => {
  // Re-probed 2026-10-17: the play ability's additional-cost declaration is
  // refused by the production cost translator, and the Repeat keyword's own
  // repeat.cost static effect is refused by the production static binder. No path
  // therefore puts the optional component into a Finalize plan, and no
  // paid-instance count reaches resolution.
  assert.throws(
    () => translateCost(play.cost, "downstage-dramatics", "play"),
    (error) => error.code === "judge-required" && /Unsupported play cost field keyword/.test(error.message)
  );
  const repeat = keywordDefinitionsById.get("Repeat");
  const [repeatCost] = repeat.expand({ host: { canonicalCardId: CANONICAL_ID }, cost: { energy: { kind: "constant", value: 2 } } });
  assert.equal(repeatCost.effect.kind, "repeat.cost");
  const board = fixture({
    cards: [{ id: "downstage", cardId: CANONICAL_ID, types: ["spell"], energy: 2, power: null, might: null }]
  });
  assert.throws(
    () => createEngineStaticBinder(board.engine).bindStatic(repeatCost, board.kernel.getObject("downstage")),
    (error) => error.code === "judge-required" && /repeat\.cost/.test(error.message) && /no layer mapping/.test(error.message)
  );
});

test("unl-061-219 Downstage Dramatics boundary: Draw 1 is the only authored body, so no extra execution is hard-coded (CR 820.1.d.1)", () => {
  // The card must not approximate Repeat by drawing twice. The interpreter's own
  // repeat control node really repeats a body once per paid instance, but nothing
  // derives that count from this card; the authored resolution still draws once.
  const kernel = world().deck(["top-card", "second-card", "third-card"], { owner: "A" }).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["downstage-dramatics.draw-one"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["top-card"]);

  const repeatedKernel = kernel.clone();
  const repeated = resolveChainBody([{
    id: "repeat-scope",
    op: "repeat",
    args: { count: { kind: "constant", value: 1 }, body: { kind: "constant", value: [drawInstruction] } }
  }], repeatedKernel);
  assert.equal(repeated.status, "executed");
  // The interpreter records the repeat iteration count as the control node's
  // receipt; the nested draw itself records the drawn card.
  assert.equal(repeated.linkedValues["repeat-scope.count"], 1);
  assert.equal(repeated.linkedValues["repeat-scope/0/downstage-dramatics.draw-one.drawn"], 1);
  assert.equal(repeatedKernel.player("A").handSize, 2);
});
