import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/spectral-matron.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-3424a772092b9d250c6d4500599a350ba292ea19b57c3ce08f4fccf1289e6478";
const ability = program.abilities[0];
const [mayPlay] = ability.body;
const [playInstruction] = mayPlay.args.body.value;
const [trashUnitTarget] = playInstruction.targets;

test("ogn-226-298 Spectral Matron: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-226-298 Spectral Matron: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The printed-cost cap has no target predicate yet (356.1.c), so the status stays judged.
  assert.match(program.judgeReason, /356\.1\.c/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(
    program.sourceText,
    "When you play me, you may play a unit costing no more than :rb_energy_3: and no more than :rb_rune_rainbow: from your trash, ignoring its cost."
  );
});

test("ogn-226-298 Spectral Matron: card-played trigger, optional, may-clause wrapped in choice.optional", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { role: "self" });
  // CR 383.3.e.2.a: "you may" is decided at Finalize.
  assert.equal(ability.optional, true);
  // Contract 3.9: the chosen instructions live inside choice.optional's body.
  assert.equal(ability.body.length, 1);
  assert.equal(mayPlay.id, "spectral-matron.may-play");
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map(instruction => instruction.id), [
    "spectral-matron.play-trash-unit"
  ]);
  assert.equal(mayPlay.linkedTo, undefined);
});

test("ogn-226-298 Spectral Matron: body is one effect.play from Trash with an ignored-cost plan", () => {
  assert.equal(playInstruction.op, "effect.play");
  assert.deepEqual(playInstruction.args.target, {
    kind: "constant",
    value: "spectral-matron.trash-unit"
  });
  // CR 356.1.b.1: "ignoring its cost" sets the base costs to zero in the finalized plan.
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [] }
  });
  assert.equal(playInstruction.linkedTo, undefined);
  assert.equal(playInstruction.targets.length, 1);
  assert.equal(trashUnitTarget.id, "spectral-matron.trash-unit");
  assert.deepEqual(trashUnitTarget.filter, {
    type: "unit",
    zone: "trash",
    owner: "controller",
    printedEnergyMax: 3,
    printedPowerMax: 1,
    printedPowerAnyDomain: true
  });
  assert.equal(trashUnitTarget.min, 1);
  assert.equal(trashUnitTarget.max, 1);
  assert.equal(trashUnitTarget.selection, "one");
  assert.equal(playInstruction.picks, undefined);
});

test("ogn-226-298 Spectral Matron: the ignored-cost play moves the chosen Trash unit onto the board", () => {
  // The reference kernel compares "controller"/"owner" placeholders literally, so the
  // Finalize-locked target set is supplied directly (same convention as other merged
  // golden tests); the printed-cost cap itself is the judged part (see judgeReason).
  const kernel = world().unit("trashed-unit", { zone: "trash" }).build();
  const run = runInstruction(play, {
    target: playInstruction.args.target.value,
    cost: playInstruction.args.cost,
    linkKey: playInstruction.args.linkKey.value
  }, {
    world: kernel,
    targets: { [trashUnitTarget.id]: [kernel.ref("trashed-unit")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("trashed-unit").zone, "board");
  // The kernel applies the supplied finalized plan first (a zero-cost pay) and then the play.
  assert.deepEqual(run.events.map(event => event.action), ["pay", "play"]);
  assert.equal(run.linked.spectralMatronPlayed, 1);
});

test("ogn-226-298 Spectral Matron: accepting the may-clause plays the locked Trash unit", () => {
  const kernel = world().unit("trashed-unit", { zone: "trash" }).build();
  kernel.setTargets(trashUnitTarget.id, [kernel.ref("trashed-unit")]);
  kernel.setAnswers({ "spectral-matron.may-play/optional": true });

  // Drop the declared TargetSpec so the reference kernel does not re-resolve the
  // "owner: controller" placeholder; Finalize target locking is supplied directly.
  const body = ability.body.map(instruction => ({
    ...instruction,
    args: {
      ...instruction.args,
      body: {
        ...instruction.args.body,
        value: instruction.args.body.value.map(({ targets, ...rest }) => rest)
      }
    }
  }));
  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["spectral-matron.play-trash-unit", "executed"],
    ["spectral-matron.may-play", "executed"]
  ]);
  assert.equal(kernel.getObject("trashed-unit").zone, "board");
});

test("ogn-226-298 Spectral Matron: declining the may-clause leaves the Trash unit alone", () => {
  const kernel = world().unit("trashed-unit", { zone: "trash" }).build();
  kernel.setTargets(trashUnitTarget.id, [kernel.ref("trashed-unit")]);
  kernel.setAnswers({ "spectral-matron.may-play/optional": false });

  const body = ability.body.map(instruction => ({
    ...instruction,
    args: {
      ...instruction.args,
      body: {
        ...instruction.args.body,
        value: instruction.args.body.value.map(({ targets, ...rest }) => rest)
      }
    }
  }));
  const outcome = resolveChainBody(body, kernel);

  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["spectral-matron.may-play", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("trashed-unit").zone, "trash");
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "ogn-226-298 Spectral Matron: the printed-cost cap (Energy <= 3 and Power <= 1 of any domain, " +
    "CR 356.1.c) needs a TargetPlan printed-cost predicate (RIFT-90); the ignore-cost plan must be " +
    "produced by the cost-plan system (RIFT-89) and the played unit's destination chosen by the " +
    "Play/Finalize flow (CR 355.4/420.3.b.1)"
);
