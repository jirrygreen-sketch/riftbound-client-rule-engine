import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/royal-entourage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a32cc7d6df90c5796f8d933adb5747a302972d467cce6c5c691af4ece82b4429";

const [ability] = program.abilities;
const [mode] = ability.body;
const [readyMode, exhaustMode] = mode.args.modes.value;
const [readyInstruction] = readyMode.body;
const [exhaustInstruction] = exhaustMode.body;

test("sfd-039-221 Royal Entourage: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-039-221 Royal Entourage: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "When you play me, ready or exhaust a legend.");
});

test("sfd-039-221 Royal Entourage: judgeReason names the Legend Zone vocabulary gap", () => {
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /ZoneId/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /choose/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /355\.10\.g/);
});

test("sfd-039-221 Royal Entourage: card-played self trigger with a two-mode choice (contract 3.9)", () => {
  // 383.4.a / 420.4.a: "When you play me" fires once the play action completes.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);

  // "ready or exhaust" is a mode choice: exactly one of the two printed modes.
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["royal-entourage.mode"]);
  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(mode.args.modes.value.map(entry => entry.id), [
    "royal-entourage.ready-mode",
    "royal-entourage.exhaust-mode"
  ]);
});

test("sfd-039-221 Royal Entourage: the blocked modes retain their non-target choose declarations", () => {
  // Preserve the existing declarations while judge-required. CR 355.10.g
  // exempts only legends "you" control; these generic choices need a target
  // plan review before the card can be marked executable.
  assert.equal(readyInstruction.id, "royal-entourage.ready-legend");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.equal(readyInstruction.args.objects.kind, "constant");
  assert.deepEqual(readyInstruction.args.objects.value, {
    kind: "choose",
    id: "royal-entourage.choose-legend-to-ready",
    filter: { type: "legend" },
    min: 1,
    max: 1,
    prompt: "Choose a legend to ready."
  });
  assert.equal(readyInstruction.linkedTo, undefined);
  assert.equal(readyInstruction.targets, undefined);

  assert.equal(exhaustInstruction.id, "royal-entourage.exhaust-legend");
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.deepEqual(exhaustInstruction.args.choose.value, {
    id: "royal-entourage.choose-legend-to-exhaust",
    filter: { type: "legend" },
    prompt: "Choose a legend to exhaust."
  });
  assert.deepEqual(exhaustInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(exhaustInstruction.linkedTo, undefined);
  assert.equal(exhaustInstruction.targets, undefined);
});

test("sfd-039-221 Royal Entourage golden: the ready branch readies the chosen legend on the merged primitive", () => {
  const kernel = world()
    .unit("chosen-legend", { types: ["legend"], exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    readyInstruction.args,
    {
      world: kernel,
      answers: { "royal-entourage.choose-legend-to-ready": [kernel.ref("chosen-legend")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("chosen-legend").exhausted, false);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [{ id: "chosen-legend", zoneEntryId: 1 }]
  });
});

test("sfd-039-221 Royal Entourage golden: the exhaust branch exhausts the chosen legend on the merged primitive", () => {
  const kernel = world()
    .unit("chosen-legend", { types: ["legend"], exhausted: false })
    .build();
  // effect.exhaust takes `choose` as literal shape data, and the production
  // adapter does not unwrap this field yet (recorded as a todo below), so the
  // golden hands the card's literal value to the merged primitive directly.
  const run = runInstruction(
    exhaust,
    { choose: exhaustInstruction.args.choose.value, amount: exhaustInstruction.args.amount },
    {
      world: kernel,
      answers: { "royal-entourage.choose-legend-to-exhaust": [kernel.ref("chosen-legend")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("chosen-legend").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["exhaust"]);
});

test("sfd-039-221 Royal Entourage golden: an already-ready legend is left untouched (CR 416.1.b)", () => {
  const kernel = world()
    .unit("ready-legend", { types: ["legend"], exhausted: false })
    .build();
  const run = runInstruction(
    ready,
    readyInstruction.args,
    {
      world: kernel,
      answers: { "royal-entourage.choose-legend-to-ready": [kernel.ref("ready-legend")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ready-legend").exhausted, false);
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked.readied, { count: 0, objects: [] });
});

test.todo(
  "sfd-039-221 Royal Entourage: the Legend Zone must exist in the frozen zone vocabulary (CR 107.4, " +
    "174.2.b) so the resolving choose can anchor a legend in its own zone and the golden can build a " +
    "legal board — the contract change request records ZoneId/ZoneDestination missing legend-zone; the " +
    "card-played trigger must also reach the chain (CR 383.4.a.2, 420.4.a)；仍需 Legend Zone 与 Finalize 模式/目标计划"
);

test("sfd-039-221 Royal Entourage golden: the ready branch executes through the production adapter", () => {
  // The production adapter hands the whole argument object to the primitive schema,
  // so effect.ready's choose selection really resolves on the merged path.
  const kernel = world()
    .unit("chosen-legend", { types: ["legend"], exhausted: true, owner: "A", controller: "A" })
    .build();
  kernel.answers.set(
    "royal-entourage.ready-legend/royal-entourage.choose-legend-to-ready",
    [kernel.ref("chosen-legend")]
  );

  const outcome = resolveChainBody([readyInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("chosen-legend").exhausted, false);
  assert.deepEqual(outcome.results[0].result.linkedValues.readied, {
    count: 1,
    objects: [{ id: "chosen-legend", zoneEntryId: 1 }]
  });
});

test("sfd-039-221 Royal Entourage golden: the exhaust branch executes when the selection is literal", () => {
  // Evidence for the judgeReason: the exhaust branch's execution depends only
  // on the selection encoding. effect.exhaust parses `choose` as literal shape
  // data; with the literal spelling the merged adapter runs the branch for
  // real, which isolates the Expr wrapper as the remaining card-side blocker.
  const kernel = world()
    .unit("chosen-legend", { types: ["legend"], exhausted: false, owner: "A", controller: "A" })
    .build();
  kernel.answers.set(
    "royal-entourage.exhaust-legend/royal-entourage.choose-legend-to-exhaust",
    [kernel.ref("chosen-legend")]
  );
  const literal = resolveChainBody(
    [{
      id: exhaustInstruction.id,
      op: exhaustInstruction.op,
      args: {
        choose: exhaustInstruction.args.choose.value,
        amount: exhaustInstruction.args.amount
      }
    }],
    kernel
  );
  assert.equal(literal.status, "executed");
  assert.equal(kernel.getObject("chosen-legend").exhausted, true);
});

test.todo(
  "sfd-039-221 Royal Entourage: the exhaust branch's Expr-wrapped choose must reach the primitive " +
    "(effect.exhaust parses `choose` as literal shape data, unlike every other argument) so the " +
    "card's own IR runs unmodified；仍需 choose 参数适配"
);
