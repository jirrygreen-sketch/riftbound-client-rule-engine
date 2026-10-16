import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/the-boss.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { createTestWorld } = await import(new URL("effects/testing/index.js", engineCore));

const [replacement, conquer] = program.abilities;
const readyInstruction = conquer.body[0];

function theBossWorld({ exhausted = true } = {}) {
  const kernel = createTestWorld();
  kernel.addObject(
    {
      ref: { id: "the-boss", zoneEntryId: 1 },
      name: "The Boss",
      owner: "A",
      controller: "A",
      zone: "board",
      exhausted,
      types: ["legend"],
      tags: ["Sett"],
      keywords: [],
      might: null,
      energy: null,
      power: null
    },
    "board"
  );
  // The reference kernel's default source is synthetic; point it at The Boss so
  // the default "source" selector in "ready me" resolves to the legend.
  Object.defineProperty(kernel, "source", { value: kernel.getObject("the-boss") });
  return kernel;
}

test("the-boss program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("the-boss identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-867768d6facbba96eedbdea3f89369bd9565961dca92d203a6b67e05e879947f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /optional/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /recall/i);
  assert.equal(
    program.sourceText,
    "When a buffed unit you control would die, you may pay :rb_rune_rainbow: and exhaust me to spend its buff and recall it exhausted instead. (Send it to base. This isn't a move.)\n" +
      "When you conquer, ready me."
  );
});

test("the-boss structure: death replacement for a buffed friendly unit with the printed remedy body", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-killed",
    filter: { type: "unit", controller: "self", buffed: true }
  });
  assert.equal(replacement.condition, undefined);
  assert.equal(replacement.with.length, 4);

  const [pay, spend, recall, exhaust] = replacement.with;
  assert.equal(pay.id, "the-boss.pay");
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.power, { kind: "constant", value: ["rainbow"] });
  assert.deepEqual(pay.args.payments, { kind: "constant", value: [{ kind: "exhaust" }] });

  assert.equal(spend.id, "the-boss.spend-buff");
  assert.equal(spend.op, "effect.buff");
  assert.deepEqual(spend.args.mode, { kind: "constant", value: "spend" });
  assert.equal(spend.linkedTo, "the-boss.pay");
  // The dying unit is the replaced event's object, not a target (CR 355.10.c),
  // so the instruction must not declare a TargetSpec named by its selector.
  assert.equal(spend.targets, undefined);

  assert.equal(recall.id, "the-boss.recall");
  assert.equal(recall.op, "effect.move");
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.equal(recall.linkedTo, "the-boss.spend-buff");

  assert.equal(exhaust.id, "the-boss.exhaust-recalled");
  assert.equal(exhaust.op, "effect.exhaust");
  assert.deepEqual(exhaust.args.pick, { kind: "constant", value: "the-boss.dying-unit" });
  assert.equal(exhaust.linkedTo, "the-boss.recall");
});

test("the-boss structure: mandatory conquer trigger that readies the legend itself", () => {
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquer", player: "self" });
  assert.equal(conquer.optional, false);
  assert.equal(conquer.trigger.once, undefined);
  assert.equal(conquer.body.length, 1);
  assert.equal(readyInstruction.id, "the-boss.ready");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {});
  assert.equal(readyInstruction.targets, undefined);
});

test("the-boss golden: 'When you conquer, ready me' really readies the legend", () => {
  const kernel = theBossWorld({ exhausted: true });
  const outcome = runAbilityBody(conquer.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("the-boss").exhausted, false);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.readied.objects, [kernel.ref("the-boss")]);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("the-boss golden: an already-ready legend is a no-op (CR 416.1.b/c)", () => {
  const kernel = theBossWorld({ exhausted: false });
  const outcome = runAbilityBody(conquer.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "the-boss replacement execution: the may decision must live on the engine-internal " +
    "replacement registration (contract 3.8), then pay rainbow + exhaust as real costs (CR " +
    "415.4/415.5; RIFT-89 cost.pay), spend the dying unit's buff (CR 702.2.b) and recall it " +
    "exhausted (CR 457/458.1/460.1; effect.move recall mode is explicitly blocked today)."
);

test.todo(
  "the-boss replaced-event object selector: bind the unit whose death is being replaced so its " +
    "buff and location can be read without making it a target (CR 355.10.c); engine batch 4 " +
    "replacement pipeline plus a contract selector for the replaced event object."
);
