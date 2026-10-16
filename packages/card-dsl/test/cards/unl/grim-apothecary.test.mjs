import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/grim-apothecary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name. resolveChainBody is the production
// chain adapter (chain/interpreter-adapter.ts), which registers every merged
// primitive for the interpreter.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-1c525c2b78fb1d50e4a202311b690745a0ec7d167eb90caa663d6c63031d10e4";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play me, you may return a friendly unit at a battlefield to its owner's hand.";

const [ambush, playedTrigger] = program.abilities;
const [mayReturn] = playedTrigger.body;
const [returnInstruction] = mayReturn.args.body.value;
const targetSpec = mayReturn.targets[0];
const MAY_REQUEST_ID = mayReturn.id + "/optional";

// Finalize-time target locking is supplied by the caller (interpreter README:
// the production caller owns Make Relevant Choices/Finalize). The reference
// kernel compares filter values literally, so the card layer's "controller"
// placeholder never matches there; the golden therefore hands the finalized
// target to the kernel directly and drops only the TargetSpec, keeping the
// card's own instructions, links and conditions (same as the merged
// ogn/monastery-of-hirana and rad/detonation-amplifier goldens).
const stripTargets = ({ targets, ...instruction }) => instruction;
const BODY_WITH_LOCKED_TARGETS = [
  {
    ...stripTargets(mayReturn),
    args: {
      ...mayReturn.args,
      body: {
        ...mayReturn.args.body,
        value: mayReturn.args.body.value.map(stripTargets)
      }
    }
  }
];

/** A two-unit board: the Apothecary plus one friendly unit at a battlefield. */
function fixture() {
  return world()
    .unit("apothecary", { might: 3 })
    .unit("ally", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
}

test("unl-021-219 Grim Apothecary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-021-219 Grim Apothecary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-021-219 Grim Apothecary: [Ambush] keyword plus the card-played Play Effect", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  // 383.4.a.1 / 383.4.a.2: "When you play me" is a Play Effect put on the chain
  // after this permanent is finalized and enters the board.
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.trigger.condition, undefined);
  assert.equal(playedTrigger.trigger.once, undefined);
  // 403.1: the printed "you may" is the instruction's optional wrapper, so the
  // trigger itself is mandatory.
  assert.equal(playedTrigger.optional, false);
  assert.equal(playedTrigger.body.length, 1);
});

test("unl-021-219 Grim Apothecary: contract 3.9 may-shape wraps the return inside choice.optional", () => {
  assert.equal(mayReturn.id, "grim-apothecary.may-return-unit");
  assert.equal(mayReturn.op, "choice.optional");
  assert.equal(mayReturn.args.body.kind, "constant");
  assert.deepEqual(mayReturn.args.body.value.map(entry => entry.id), [
    "grim-apothecary.return-unit"
  ]);
  // 355.7 / 355.12: "a friendly unit at a battlefield" is chosen, so it is a
  // target and the TargetSpec sits on the may node, locked with the play.
  assert.deepEqual(targetSpec, {
    id: "grim-apothecary.friendly-unit",
    filter: {
      type: "unit",
      controller: "controller",
      location: { type: "battlefield" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(mayReturn.picks, undefined);
  // The return body carries no target of its own and never links back to the
  // choice node (contract 3.9 forbids the choice + linkedTo shape).
  assert.equal(returnInstruction.op, "effect.zone");
  assert.deepEqual(returnInstruction.args, {
    target: { kind: "constant", value: targetSpec.id },
    to: { kind: "constant", value: "hand" }
  });
  assert.equal(returnInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.targets, undefined);
});

test("unl-021-219 Grim Apothecary golden: accepting returns the locked unit to its owner's hand", () => {
  const kernel = fixture();
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  kernel.setAnswers({ [MAY_REQUEST_ID]: true });
  const outcome = resolveChainBody(BODY_WITH_LOCKED_TARGETS, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["grim-apothecary.return-unit", "executed"],
    ["grim-apothecary.may-return-unit", "executed"]
  ]);
  // 055 / 108: the unit leaves the Battlefield and is routed to its owner's hand.
  assert.equal(kernel.getObject("ally").zone, "hand");
  assert.equal(kernel.getObject("ally").owner, "A");
  assert.deepEqual(kernel.events.map(event => event.action), ["return-to-hand"]);
});

test("unl-021-219 Grim Apothecary golden: declining skips the return and leaves the unit in place", () => {
  const kernel = fixture();
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  kernel.setAnswers({ [MAY_REQUEST_ID]: false });
  const outcome = resolveChainBody(BODY_WITH_LOCKED_TARGETS, kernel);

  assert.deepEqual(outcome.results.map(entry => entry.id), [
    "grim-apothecary.may-return-unit"
  ]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("unl-021-219 Grim Apothecary golden: a unit that left its zone makes the may ignored (CR 359.3.e)", () => {
  const kernel = fixture();
  const stale = kernel.ref("ally");
  // The unit changed zones after Finalize locked it (move-location alone keeps
  // the same zone-bound identity; a zone change invalidates the reference).
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);
  kernel.setAnswers({ [MAY_REQUEST_ID]: true });

  const outcome = resolveChainBody(BODY_WITH_LOCKED_TARGETS, kernel);
  assert.equal(outcome.status, "partial");
  // The ignored child is still reported, followed by its container.
  assert.deepEqual(outcome.results.map(entry => entry.id), [
    "grim-apothecary.return-unit",
    "grim-apothecary.may-return-unit"
  ]);
  assert.deepEqual(
    outcome.results.find(entry => entry.id === "grim-apothecary.return-unit").result,
    { status: "ignored", reason: "mistargeted" }
  );
  // A container with no executed child is ignored as well.
  assert.deepEqual(
    outcome.results.find(entry => entry.id === "grim-apothecary.may-return-unit").result,
    { status: "ignored", reason: "mistargeted" }
  );
  // The unit is in the Trash and the return instruction never ran; the only
  // event is the kill that invalidated the locked reference.
  assert.equal(kernel.getObject("ally").zone, "trash");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test("unl-021-219 Grim Apothecary golden: the merged effect.zone alone performs the card's return", () => {
  const kernel = fixture();
  const run = runInstruction(
    zone,
    { target: targetSpec.id, to: returnInstruction.args.to },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked, { moved: 1, movedIds: ["ally"], destination: "hand" });
  assert.equal(kernel.getObject("ally").zone, "hand");
});

test.todo(
  "unl-021-219 Grim Apothecary: [Ambush] expansion (CR 822.1.b battlefield-with-your-units play permission and" +
    " 822.1.c Reaction permission) through an Ambush KeywordDef (RIFT-84) and the chain canAct permissions"
);
test.todo(
  "unl-021-219 Grim Apothecary: the card-played Play Effect enters the chain as a Pending item after the unit is" +
    " played (CR 383.4.a.2) — needs the CardProgram -> TriggerRegistration adapter (RIFT-120)"
);
