import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/lacerate.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import empower from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder, createProgramBinding, expandProgram } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-918c7c0acc1cff3bf6bc9579ca9dc1dfeec36e9b894becddb7b0eb8918a44cad";
const SOURCE_TEXT =
  "Choose a unit. If it's [Empowered], disempower it. Then kill it if it has 3 :rb_might: or less.\n" +
  "[Flow] :rb_energy_4::rb_rune_order::rb_rune_order: (You may play this from your trash for its Flow cost. Then banish it.)";
const TARGET_ID = "lacerate.unit";

const [flowKeyword, play] = program.abilities;
const [disempower, killIfSmall] = play.body;

/** Execute the card's real body with the Finalize-locked target the chain supplies. */
function resolveOn(kernel) {
  return resolveChainBody(play.body, kernel);
}

test("ven-127-166 Lacerate: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-127-166 Lacerate: judgeReason names the remaining Flow bindings and layered Disempower rule", () => {
  assert.match(program.judgeReason, /829/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /实付 Flow 实例/);
  assert.match(program.judgeReason, /flow\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /443\.1\.b/);
  // 443.1.a.1: the Empowered clause is equivalent to an unconditional Disempower.
  assert.match(program.judgeReason, /443\.1\.a\.1/);
  assert.match(program.judgeReason, /不把 Flow 降级成普通费用/);
});

test("ven-127-166 Lacerate: [Flow] plus Disempower and the Might-3 kill clause", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["lacerate.disempower", "effect.empower"],
    ["lacerate.kill-if-small", "effect.kill"]
  ]);

  // 443.1/443.1.a: the Disempower half; 443.1.a.1 makes the not-Empowered case a no-op, so
  // no extra state predicate is declared (it would be an approximation of the same rule).
  assert.deepEqual(disempower.args, {
    mode: { kind: "constant", value: "disempower" },
    objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } }
  });
  assert.deepEqual(disempower.targets, [
    { id: TARGET_ID, filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }
  ]);
  assert.equal(disempower.condition, undefined);

  // "Then kill it if it has 3 Might or less": the same locked unit, Effective Might
  // (143.2.a.1) compared against the printed 3 at resolution.
  assert.equal(killIfSmall.op, "effect.kill");
  assert.deepEqual(killIfSmall.args, { target: { kind: "constant", value: TARGET_ID } });
  assert.deepEqual(killIfSmall.condition, {
    kind: "compare",
    left: { kind: "object-property", object: { target: TARGET_ID }, property: "might" },
    operator: "lte",
    right: { kind: "constant", value: 3 }
  });
  assert.equal(killIfSmall.targets, undefined);
  assert.equal(killIfSmall.linkedTo, undefined);

  // The declared ops really are the merged primitives.
  assert.equal(instructionDefinitionsById.get("effect.empower"), empower);
  assert.equal(instructionDefinitionsById.get("effect.kill"), kill);
  assert.equal(keywordDefinitionsById.has("Flow"), true);
});

test("ven-127-166 Lacerate golden: a 2-Might unit is disempowered and killed", () => {
  const kernel = world().unit("small", { owner: "B", controller: "B", might: 2 }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("small")]);
  // The reference kernel's disempower action zeroes the empowered counter even when it was 0,
  // exactly as 443.1.a.1 describes ("will do nothing" to the board state beyond the action).
  const outcome = resolveOn(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["lacerate.disempower", "executed"],
    ["lacerate.kill-if-small", "executed"]
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["disempower", "kill"]);
  assert.equal(kernel.getObject("small").zone, "trash");
});

test("ven-127-166 Lacerate golden: a 4-Might unit is disempowered but not killed (143.2.a.1)", () => {
  const kernel = world().unit("big", { owner: "B", controller: "B", might: 4 }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("big")]);

  const outcome = resolveOn(kernel);

  // The kill clause's condition is false, so the instruction is skipped (contract 3.4: a
  // condition guards only its own instruction) while the Disempower half still resolves.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["lacerate.disempower", "executed"],
    ["lacerate.kill-if-small", "negated"]
  ]);
  assert.deepEqual(outcome.results[1].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("big").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["disempower"]);
});

test("ven-127-166 Lacerate golden: exactly 3 Might still dies (the clause is 'or less')", () => {
  const kernel = world().unit("three", { owner: "B", controller: "B", might: 3 }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("three")]);

  const outcome = resolveOn(kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.result.status), ["executed", "executed"]);
  assert.equal(kernel.getObject("three").zone, "trash");
});

test("ven-127-166 Lacerate golden: a stale locked unit ignores both halves (359.3.e.6-e.8)", () => {
  const kernel = world().unit("gone", { owner: "B", controller: "B", might: 2 }).build();
  const stale = kernel.ref("gone");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(TARGET_ID, [stale]);

  const outcome = resolveOn(kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("gone").zone, "hand");
  assert.deepEqual(outcome.events, []);
});

test("ven-127-166 Lacerate: the merged Disempower primitive really is what runs", () => {
  // Direct primitive evidence for the first half with a pre-empowered target: the merged
  // effect.empower clears the state through the closed disempower GameAction.
  const kernel = world().unit("empowered", { owner: "B", controller: "B", might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("empowered") });
  const empowered = runInstruction(empower, {}, { world: scoped });
  assert.equal(empowered.result.status, "executed");
  assert.equal(scoped.getObject("empowered").empowered, 1);
  const run = runInstruction(
    empower,
    { mode: { kind: "constant", value: "disempower" }, objects: { kind: "constant", value: { kind: "target", id: TARGET_ID } } },
    { world: scoped, targets: { [TARGET_ID]: [kernel.ref("empowered")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["disempower"]);
  assert.equal(run.linked["disempowered.count"], 1);
  assert.equal(scoped.getObject("empowered").empowered, 0);
});

test.todo(
  "ven-127-166 Lacerate: play from Trash for the printed Flow cost (4 energy + 2 Order runes) and " +
    "banish the spell when it leaves the Chain by 829.1.b (not by its own execution, 829.1.b.1) — " +
    "needs printed keyword-cost forwarding and paid-instance Chain-exit replacement binding"
);

test.todo("Lacerate: Disempower removes one stacked status (443.1.b) and does nothing to an unempowered unit (443.1.a.1)");

test("ven-127-166 Lacerate evidence: the [Flow] expansion still cannot bind and describePlay fails closed", () => {
  // Re-measured 2026-10-18: the printed Flow cost still has no carrier and the
  // expanded static flow.cost has no static layer mapping, so the alternative
  // cost never reaches a Finalize plan.
  const source = world()
    .object("lacerate", { cardId: CARD_ID, types: ["spell"], zone: "hand", energy: 2, power: ["Order"], might: null })
    .build()
    .getObject("lacerate");
  const expanded = expandProgram(program, source).expanded;
  const flowCost = expanded.find((ability) => ability.kind === "static" && ability.effect.kind === "flow.cost");
  assert.ok(flowCost, "the merged Flow KeywordDef expands to a static flow.cost");
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.throws(
    () => createEngineStaticBinder(fixture({ cards: [] }).engine).bindStatic(flowCost, source),
    error => error.constructor.name === "ProgramBindingError" &&
      /Static ability kind flow\.cost has no layer mapping/.test(error.message)
  );

  // The production play path refuses the card itself, so no trash play or
  // banish-on-leave can be reached from the declared program.
  assert.throws(
    () => binding.describePlay({ type: "play", object: source.ref, player: "A" }, source),
    error => error.code === "judge-required" && /params\.cost/.test(error.message)
  );
});

test("ven-127-166 Lacerate evidence: disempower clears every stacked status (443.1.b)", () => {
  // The reference kernel's disempower action sets the counter to 0, so a card
  // that was Empowered twice loses both statuses instead of one. This is the
  // measured reason the Disempower half cannot be called executable yet.
  const kernel = world().unit("stacked", { owner: "B", controller: "B", might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("stacked") });
  assert.equal(scoped.perform({ type: "empower", object: scoped.ref("stacked"), amount: 2 }).status, "done");
  assert.equal(scoped.getObject("stacked").empowered, 2);
  scoped.setTargets(TARGET_ID, [scoped.ref("stacked")]);
  const outcome = resolveOn(scoped);
  assert.equal(outcome.results[0].result.status, "executed");
  // 443.1.b requires removing exactly one status; the merged action removes all.
  assert.equal(scoped.getObject("stacked").empowered, 0);
});

test("ven-127-166 Lacerate evidence: disempowering an unempowered unit still reports an action (443.1.a.1)", () => {
  // 443.1.a.1 says the instruction does nothing to an object that is not
  // Empowered, but the merged action still submits a disempower GameAction and
  // emits the event; the board state is unchanged, which is what the golden
  // above asserts.
  const kernel = world().unit("plain", { owner: "B", controller: "B", might: 4 }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("plain")]);
  const outcome = resolveOn(kernel);
  assert.deepEqual(outcome.events.map((event) => event.action), ["disempower"]);
  assert.equal(kernel.getObject("plain").empowered, 0);
  assert.equal(kernel.getObject("plain").zone, "board");
});
