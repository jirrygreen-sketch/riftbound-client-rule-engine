import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/sanction.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import empower from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-cc029bf96714e13a2e9bbc9f58b4d2a300a4d50e4257125afc218854ce4b3acf";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose one —\n" +
  "Empower a unit. Disempower it at end of turn.Disempower a unit that's [Empowered]. Empower it at end of turn.";

const [reactionKeyword, play] = program.abilities;
const [chooseOne] = play.body;
const [firstMode, secondMode] = chooseOne.args.modes.value;
const [empowerUnit, delayedDisempower] = firstMode.body;
const [disempowerUnit, delayedEmpower] = secondMode.body;

test("ven-035-166 Sanction: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-035-166 Sanction: identity, ruleset, status, judgeReason and the verbatim catalog text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The catalog runs the two modes together ("turn.Disempower"); sourceText must
  // stay exactly the local evidence even though the official card face has two
  // separate bullets (reported as a data issue, not fixed here).
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /trigger\.delayed|registerDelayedTrigger/);
  assert.match(program.judgeReason, /391\.2/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /355\.3/);
  // The Finalize block lives in the play-pipeline surface check; the
  // interpreter-side choice.mode primitive itself is merged and executed below.
  assert.match(program.judgeReason, /validateSurface/);
});

test("ven-035-166 Sanction: [Reaction], printed cost and one mode choice (355.3)", () => {
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(chooseOne.id, "sanction.choose-one");
  assert.equal(chooseOne.op, "choice.mode");
  assert.deepEqual(chooseOne.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseOne.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    chooseOne.args.modes.value.map(mode => mode.id),
    ["sanction.empower-then-disempower", "sanction.disempower-then-empower"]
  );
  assert.equal(chooseOne.linkedTo, undefined);
});

test("ven-035-166 Sanction: mode 1 empowers a unit then schedules the end-of-turn disempower", () => {
  // "Empower a unit": 442.1's Empower action on one chosen Board unit.
  assert.equal(empowerUnit.id, "sanction.empower-unit");
  assert.equal(empowerUnit.op, "effect.empower");
  assert.deepEqual(empowerUnit.args.mode, { kind: "constant", value: "empower" });
  assert.deepEqual(empowerUnit.targets, [
    {
      id: "sanction.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "Disempower it at end of turn": a delayed ability created by the resolving
  // spell (391.2) whose body is the real Disempower (443.1) on the same unit.
  assert.equal(delayedDisempower.id, "sanction.delayed-disempower");
  assert.equal(delayedDisempower.op, "trigger.delayed");
  assert.deepEqual(delayedDisempower.args.at, { kind: "constant", value: "turn-end" });
  assert.deepEqual(delayedDisempower.args.duration, { kind: "constant", value: "this-turn" });
  const [endDisempower] = delayedDisempower.args.body.value;
  assert.equal(endDisempower.op, "effect.empower");
  assert.deepEqual(endDisempower.args.mode, { kind: "constant", value: "disempower" });
  assert.deepEqual(endDisempower.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "sanction.unit" }
  });
  // The delayed effect does not depend on the first instruction's result:
  // 442.1.c makes an Empower of an already-Empowered object do nothing while the
  // end-of-turn Disempower still happens.
  assert.equal(delayedDisempower.linkedTo, undefined);
});

test("ven-035-166 Sanction: mode 2 disempowers an Empowered unit then schedules the end-of-turn empower", () => {
  assert.equal(disempowerUnit.id, "sanction.disempower-unit");
  assert.equal(disempowerUnit.op, "effect.empower");
  assert.deepEqual(disempowerUnit.args.mode, { kind: "constant", value: "disempower" });
  // "a unit that's [Empowered]": the state restriction is recorded, never
  // widened to any unit (the merged matcher has no empowered predicate).
  assert.deepEqual(disempowerUnit.targets, [
    {
      id: "sanction.empowered-unit",
      filter: { type: "unit", zone: "board", empowered: true },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  assert.equal(delayedEmpower.id, "sanction.delayed-empower");
  assert.equal(delayedEmpower.op, "trigger.delayed");
  assert.deepEqual(delayedEmpower.args.at, { kind: "constant", value: "turn-end" });
  const [endEmpower] = delayedEmpower.args.body.value;
  assert.equal(endEmpower.op, "effect.empower");
  assert.deepEqual(endEmpower.args.mode, { kind: "constant", value: "empower" });
  assert.deepEqual(endEmpower.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "sanction.empowered-unit" }
  });
});

test("ven-035-166 Sanction golden: the merged Empower action runs for mode 1's first clause", () => {
  const kernel = world().unit("unit", { zone: "board" }).build();
  const locked = kernel.ref("unit");

  const run = runInstruction(empower, empowerUnit.args, {
    world: kernel,
    targets: { "sanction.unit": [locked] }
  });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["empower"]);
  assert.equal(run.linked["empowered.count"], 1);
  assert.deepEqual(run.linked["empowered.objects"], [locked]);
});

test("ven-035-166 Sanction golden: the merged Disempower action runs for mode 2's first clause", () => {
  const kernel = world().unit("unit", { zone: "board" }).build();
  const locked = kernel.ref("unit");
  kernel.perform({ type: "empower", object: locked });

  const run = runInstruction(empower, disempowerUnit.args, {
    world: kernel,
    targets: { "sanction.empowered-unit": [locked] }
  });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["disempower"]);
  assert.equal(run.linked["disempowered.count"], 1);
  assert.deepEqual(run.linked["disempowered.objects"], [locked]);
});

test("ven-035-166 Sanction boundary: Disempower on a unit that left the Board is ignored (359.3.e)", () => {
  const kernel = world().unit("unit", { zone: "board" }).build();
  const stale = kernel.ref("unit");
  kernel.perform({ type: "kill", object: stale });

  const run = runInstruction(empower, disempowerUnit.args, {
    world: kernel,
    targets: { "sanction.empowered-unit": [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

/**
 * The choice.mode interpreter primitive is merged; what is missing is the
 * play-pipeline adapter (programs/play.ts validateSurface rejects choice.mode,
 * see judgeReason). These goldens execute the card's real play body through the
 * chain interpreter adapter with the delayed actions pruned: trigger.delayed is
 * the separately recorded gap 1 and has no opcode to execute.
 */
const prunedModeBody = () => {
  const body = JSON.parse(JSON.stringify(play.body));
  const [chooseInstruction] = body;
  chooseInstruction.args.modes.value = chooseInstruction.args.modes.value.map(mode => ({
    ...mode,
    body: mode.body.filter(instruction => instruction.op !== "trigger.delayed")
  }));
  return body;
};

test("ven-035-166 Sanction golden: mode 1 empowers the chosen unit through the real choice", () => {
  const kernel = world().unit("unit", { zone: "board" }).build();
  kernel.setAnswers({ "sanction.choose-one/mode%3A0": "sanction.empower-then-disempower" });
  kernel.setTargets("sanction.unit", [kernel.ref("unit")]);

  const outcome = resolveChainBody(prunedModeBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["sanction.empower-unit", "executed"],
    ["sanction.choose-one", "executed"]
  ]);
  assert.deepEqual(outcome.linkedValues["sanction.choose-one.value"], ["sanction.empower-then-disempower"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["empower"]);
});

test("ven-035-166 Sanction golden: mode 2 disempowers the chosen Empowered unit through the real choice", () => {
  const kernel = world().unit("unit", { zone: "board" }).build();
  kernel.perform({ type: "empower", object: kernel.ref("unit") });
  kernel.setAnswers({ "sanction.choose-one/mode%3A0": "sanction.disempower-then-empower" });
  kernel.setTargets("sanction.empowered-unit", [kernel.ref("unit")]);

  const outcome = resolveChainBody(prunedModeBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["sanction.disempower-unit", "executed"],
    ["sanction.choose-one", "executed"]
  ]);
  assert.deepEqual(outcome.linkedValues["sanction.choose-one.value"], ["sanction.disempower-then-empower"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["empower", "disempower"]);
});

test.todo(
  "ven-035-166 Sanction: register the two 'at end of turn' delayed actions (391.2, turn-end) — " +
    "effects/instructions has no card-facing trigger.delayed opcode even though " +
    "ResolveContext.registerDelayedTrigger exists"
);

test.todo(
  "ven-035-166 Sanction: restrict mode 2's target to an Empowered unit and rely on 442.1.b/443.1.a " +
    "(Empower/Disempower affect only the current state) — ObjectSnapshot exposes no Empowered state and the " +
    "merged filter vocabulary has no empowered predicate (contract gap recorded in effect.empower)"
);

test.todo(
  "ven-035-166 Sanction: decide the mode at Finalize (355.3) — chain/engine.ts " +
    "programs/play.ts validateSurface judge-requires choice.mode until the Finalize/Resolve " +
    "choice-plan adapter lands; the interpreter-side choice.mode primitive executes"
);
