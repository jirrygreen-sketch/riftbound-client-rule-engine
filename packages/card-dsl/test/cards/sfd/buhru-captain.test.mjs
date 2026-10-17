import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/buhru-captain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9d2270f21698ed5fabefab3f109954da05ef53159ad4d61436d7f4f6c978d4e7";
const SOURCE_TEXT =
  "When you play me, you may draw 1 or buff me. (To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)";

const [ability] = program.abilities;
const [mode] = ability.body;
const [drawMode, buffMode] = mode.args.modes.value;
const [drawInstruction] = drawMode.body;
const [buffInstruction] = buffMode.body;
const [selfSpec] = buffInstruction.targets;

/** The kernel binds "self" through the context source, so the unit is the source. */
function captainWorld({ buffs = 0 } = {}) {
  const kernel = world().unit("captain", { might: 3, buffs }).build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("captain") });
  return kernel;
}

test("sfd-091-221 Buhru Captain: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-091-221 Buhru Captain: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-091-221 Buhru Captain: judgeReason names the choice.mode chain block and the may-or reading", () => {
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /355\.3/);
  assert.match(program.judgeReason, /Finalize\/Resolve/);
  assert.match(program.judgeReason, /validateSurface/);
  assert.ok(!/RIFT-\d+/.test(program.judgeReason));
});

test("sfd-091-221 Buhru Captain: card-played self trigger with a one-of-two mode choice", () => {
  // 383.4.a / 420.4.a: "When you play me" is a Play Effect that fires once the
  // play action completes. 403.1: the printed "you may" belongs to the effect,
  // so the ability itself is mandatory and the choice lives in the body.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);

  // 355.3 / contract 3.9: exactly one of the two printed "or" modes.
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["buhru-captain.mode"]);
  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(mode.args.prompt, { kind: "constant", value: "Draw 1 or buff me?" });
  assert.deepEqual(mode.args.modes.value.map(entry => entry.id), [
    "buhru-captain.draw-mode",
    "buhru-captain.buff-mode"
  ]);
  assert.equal(mode.targets, undefined);
  assert.equal(mode.picks, undefined);
  assert.equal(mode.linkedTo, undefined);
});

test("sfd-091-221 Buhru Captain: the draw mode draws 1 for the controller (414.1/414.3)", () => {
  assert.equal(drawInstruction.id, "buhru-captain.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("sfd-091-221 Buhru Captain: the buff mode buffers the host through the self anchor", () => {
  assert.equal(buffInstruction.id, "buhru-captain.buff");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "buhru-captain.self" }
  });
  // 355.10.d.1: "me" is programmatically selected, so it is never a choice; the
  // contract 3.6 "self" selector binds the host at runtime.
  assert.deepEqual(selfSpec, {
    id: "buhru-captain.self",
    filter: { object: "self", type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("sfd-091-221 Buhru Captain golden: the merged draw primitive draws the top card", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("sfd-091-221 Buhru Captain golden: the buff mode places exactly one Buff on the host", () => {
  const kernel = captainWorld();
  // Finalize locks the target set; the reference kernel compares the filter's
  // raw values and ignores the contract 3.6 "object" anchor (the target anchor
  // lifecycle owns that binding), so the golden pins the host reference itself.
  kernel.setTargets("buhru-captain.self", [kernel.ref("captain")]);
  // resolveChainBody is the production card-body path: it unwraps the declared
  // literal fields (effect.buff mode/target) for the merged primitive.
  const outcome = resolveChainBody([buffInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["buhru-captain.buff", "executed"]
  ]);
  assert.equal(kernel.getObject("captain").buffs, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("sfd-091-221 Buhru Captain golden: an already-buffed unit is not buffed again (702.3.a)", () => {
  const kernel = captainWorld({ buffs: 1 });
  kernel.setTargets("buhru-captain.self", [kernel.ref("captain")]);
  const outcome = resolveChainBody([buffInstruction], kernel);
  // 427.1.c / 702.3.a: the unit stays a legal choice but no second Buff lands.
  assert.deepEqual(outcome.results.map(entry => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("captain").buffs, 1);
  assert.deepEqual(outcome.events, []);
});

test("sfd-091-221 Buhru Captain golden: the declared mode choice really selects and runs one branch", () => {
  // 355.3 / contract 3.9: the printed "or" is a mode choice of exactly one of
  // the two declared modes. The interpreter selects the answered mode and runs
  // only its body — the draw branch draws, and the buff branch never runs.
  const kernel = world().deck(["a", "b"]).build();
  kernel.setAnswers({ "buhru-captain.mode/mode%3A0": "buhru-captain.draw-mode" });

  const outcome = resolveChainBody([mode], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["buhru-captain.mode.value"], ["buhru-captain.draw-mode"]);
  assert.equal(kernel.player("A").handSize, 1);
  // The buff branch did not run: no mode execution for it and no Buff landed.
  assert.deepEqual([...new Set(outcome.results.map((entry) => entry.id))], [
    "buhru-captain.draw",
    "buhru-captain.mode"
  ]);
});

test("sfd-091-221 Buhru Captain golden: selecting the buff mode buffers the host instead of drawing", () => {
  const kernel = captainWorld();
  kernel.setTargets("buhru-captain.self", [kernel.ref("captain")]);
  kernel.setAnswers({ "buhru-captain.mode/mode%3A0": "buhru-captain.buff-mode" });

  const outcome = resolveChainBody([mode], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["buhru-captain.mode.value"], ["buhru-captain.buff-mode"]);
  assert.equal(kernel.getObject("captain").buffs, 1);
  // "or" is exclusive: the draw branch never runs when the buff mode is chosen.
  assert.deepEqual([...new Set(outcome.results.map((entry) => entry.id))], [
    "buhru-captain.buff",
    "buhru-captain.mode"
  ]);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "sfd-091-221 Buhru Captain: the choice.mode branch must survive the chain's Finalize/Resolve choice-plan " +
    "adapter — chain/engine.ts assertFinalizationSurface throws ChainContractBlockedError for any body " +
    "choice.mode, and the play binding's validateSurface rejects it too"
);

test.todo(
  "sfd-091-221 Buhru Captain: rule on the 'you may draw 1 or buff me' reading — whether the leading 'may' " +
    "lets the controller decline the whole effect (choice.optional around choice.mode) or the printed 'or' is " +
    "only a mode choice; CR v1.5 355.3 covers bulleted mode lists and does not settle this phrasing"
);

test.todo(
  "sfd-091-221 Buhru Captain: the card-played trigger must reach the chain and re-check the { source: \"self\" } " +
    "anchor at Finalize/Resolve (383.4.a.2, 420.4.a, 355.8) — the trigger registration and the target anchor " +
    "lifecycle are the remaining binding dependencies"
);
