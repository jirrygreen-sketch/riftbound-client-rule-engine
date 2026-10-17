import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-merciless.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { createTestWorld } = await import(new URL("effects/testing/index.js", engineCore));

const lucianWorld = ({ exhausted } = {}) => {
  const kernel = createTestWorld();
  kernel.addObject(
    {
      ref: { id: "lucian", zoneEntryId: 1 },
      owner: "A",
      zone: "board",
      exhausted,
      might: 3,
      types: ["unit"]
    },
    "board"
  );
  // The reference kernel's default source is a synthetic "source" object;
  // point it at lucian so "ready me" (effect.ready with no args) resolves
  // against the unit itself.
  Object.defineProperty(kernel, "source", { value: kernel.getObject("lucian") });
  return kernel;
};

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /[Ww]eaponmaster/);
  assert.ok(program.sourceText.includes("[Weaponmaster]"));
  assert.ok(program.sourceText.includes("The first time I conquer each turn, ready me."));
});

test("abilities: Weaponmaster keyword plus a per-turn conquer trigger that readies self", () => {
  assert.equal(program.abilities.length, 2);

  const keyword = program.abilities[0];
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "weaponmaster");
  assert.equal(keyword.value, undefined);

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquered", role: "self" });
  assert.equal(triggered.trigger.once, "per-turn");
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const instruction = triggered.body[0];
  assert.equal(instruction.id, "ready-self");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("conquer trigger body executes through the interpreter and reference kernel: 'ready me'", () => {
  // effect.ready with no args defaults to { kind: "source" } ("ready me").
  const kernel = lucianWorld({ exhausted: true });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
});

test("conquer trigger body on an already-ready source is a no-op (CR 416.1.c)", () => {
  const kernel = lucianWorld({ exhausted: false });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
});

test.todo(
  "Weaponmaster expansion: on play, choose one of your Equipment, pay its Equip cost reduced by " +
    "[A], attach it to me (CR 821.1.c; cost.modify rejects reduce-equip-cost until the cost " +
    "plan carries the original [A]/[C] symbol binding for 821.1.c.2)"
);

test.todo(
  "Conquer trigger end-to-end: subscribe at the 'conquer' timing point with the self filter and " +
    "once-per-turn lifetime through the trigger pipeline — the scoring conquer emission carries " +
    "only player/details and no object, so the self filter can never match"
);
