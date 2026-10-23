import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/leblanc-fragmented.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import assaultKeyword from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-b8d443a7b94f10a4f56f95ffc2b338f17de7a1fbc3a76e380bf2cd67a5436a7e";
const SOURCE_TEXT =
  "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
  "[Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead. (When I die, get the effect.)";

const [assault, deathknell, triggered] = program.abilities;
const [drawOne, drawTwo] = triggered.body;

test("unl-172-219 LeBlanc, Fragmented: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-172-219 LeBlanc, Fragmented: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /807\.1/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /Beginning Phase/);
  // Re-checked against the merged sources: the Assault gap is now the
  // designation/combatRole field mismatch (conditions are evaluated and fail
  // closed), the Deathknell gap is the unregistered trigger.leave op, and the
  // Beginning-Phase gap is the missing readable phase characteristic.
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  // The exported op registry really carries no trigger.* primitive, and the
  // designation mapping exists only in the unwired expr-ext module.
  assert.match(program.judgeReason, /45 个 op/);
  assert.match(program.judgeReason, /expr-ext/);
  assert.doesNotMatch(program.judgeReason, /layers 的条件求值也不读 compare|未识别条件按 true/);
});

test("unl-172-219 LeBlanc, Fragmented: [Assault] and [Deathknell] are declared, never expanded in the card", () => {
  // 807.1.b.3: the printed Assault has no value, so value is omitted (default 1 is
  // the keyword expansion's job, contract 3.7).
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(assault.value, undefined);
  // 808.1: Deathknell is only declared here; the [Effect] is attached below as an
  // object-killed trigger (the ruined-rex / kogmaw-caustic shape).
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
});

test("unl-172-219 LeBlanc, Fragmented: Deathknell is registered and exposes the merged object-killed skeleton", () => {
  const definition = keywordDefinitionsById.get("Deathknell");
  assert.ok(definition, "effects/keywords/Deathknell.ts must be registered");
  const [expanded] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.trigger.at, "object-killed");
  assert.deepEqual(expanded.trigger.filter, {
    self: true
  });
  assert.deepEqual(expanded.body.map(instruction => [instruction.id, instruction.op]), [
    [`deathknell:${CANONICAL_ID}:leave`, "trigger.leave"]
  ]);
});

test("unl-172-219 LeBlanc, Fragmented: the Deathknell effect is an object-killed trigger of the host", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(triggered.kind, "triggered");
  // 808.1.c / 808.1.d: "When I die" = this card being killed (object-killed,
  // put on the chain before it is placed in Trash).
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("unl-172-219 LeBlanc, Fragmented: 'draw 1' and the 'draw 2 instead' branch are mutually exclusive", () => {
  assert.deepEqual(triggered.body.map(instruction => [instruction.id, instruction.op]), [
    ["leblanc-fragmented.draw-1", "effect.draw"],
    ["leblanc-fragmented.draw-2", "effect.draw"]
  ]);
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawTwo.args.amount, { kind: "constant", value: 2 });
  // 367: "draw 2 instead" replaces the printed "Draw 1." — the two branches are
  // guarded by complementary conditions on the same Beginning-Phase placeholder.
  assert.equal(drawOne.condition.kind, "not");
  assert.deepEqual(drawOne.condition.condition, drawTwo.condition);
  assert.equal(drawTwo.condition.kind, "compare");
  assert.equal(drawTwo.condition.operator, "eq");
  assert.deepEqual(drawTwo.condition.left, {
    kind: "object-property",
    object: "self",
    property: "leblanc-fragmented.controller-beginning-phase"
  });
  assert.deepEqual(drawTwo.condition.right, { kind: "constant", value: true });
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawTwo.picks, undefined);
});

test("unl-172-219 LeBlanc, Fragmented golden: 'Draw 1.' moves the top card of the deck to hand", () => {
  // 414.3: the printed Draw 1 is the merged effect.draw primitive.
  // An array deck() call lists cards top-to-bottom: "top" is the first card drawn.
  const kernel = world().deck(["top", "bottom"], { owner: "A" }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
});

test("unl-172-219 LeBlanc, Fragmented golden: the Beginning-Phase branch draws 2 through the same primitive", () => {
  const kernel = world().deck(["c1", "c2", "c3"], { owner: "A" }).build();
  const run = runInstruction(draw, drawTwo.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["c1", "c2"]);
});

test("unl-172-219 LeBlanc, Fragmented golden: the unreadable phase characteristic turns both draw branches into ignored instructions", () => {
  // 383.2.a.1: the printed "If it's your Beginning Phase" needs a readable
  // phase characteristic. ObjectSnapshot has no phase field, so the authored
  // placeholder property raises MissingInformation while the condition is
  // evaluated; the interpreter classifies that as ignored/mistargeted. Neither
  // branch resolves, so the card cannot draw at all until the phase state is
  // readable (the 'draw 2 instead' wording of 367 is a second, separate gap).
  const kernel = world().deck(["top", "second"], { owner: "A" }).unit("leblanc").build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("leblanc"), controller: "A" });
  const outcome = resolveChainBody(triggered.body, scoped);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["leblanc-fragmented.draw-1", "ignored", "mistargeted"],
      ["leblanc-fragmented.draw-2", "ignored", "mistargeted"]
    ]
  );
  assert.deepEqual(scoped.zone("A", "hand"), []);
  // The reference kernel resolves the same unreadable property to null, which
  // is why the placeholder alone is not evidence of a working predicate.
  assert.equal(kernel.test(drawTwo.condition), false);
});

test("unl-172-219 LeBlanc, Fragmented: [Assault] binds but its designation predicate stays fail-closed", () => {
  // The KeywordDef reads the host "designation" characteristic; ObjectSnapshot
  // exposes combatRole instead. The production binder installs the entry, and
  // the evaluator fails closed rather than silently treating combatRole as the
  // old characteristic.
  const [expansion] = assaultKeyword.expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  const f = fixture({
    cards: [{ id: "leblanc", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Order"], might: 3 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("leblanc"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("leblanc"), combatRole: "attacker" };
  f.engine.layers.setObjects([source]);
  const handle = createEngineStaticBinder(f.engine).bindStatic(expansion, source);
  const [registration] = f.engine.layers.registry.list();
  assert.deepEqual(registration.effect.effect.amount, { kind: "constant", value: 1 });
  assert.equal(typeof registration.effect.effect.condition, "function");
  assert.equal(f.engine.layers.evaluate(source.ref).might, 3);
  handle.unbind();
});

test("unl-172-219 LeBlanc, Fragmented: the generated op registry contains trigger.leave", async () => {
  const { registry } = await import("../../../../engine-core/dist/effects/instructions/registry.generated.js");
  const ops = registry.map(entry => entry.op ?? entry.id ?? entry.keyword);
  assert.equal(ops.includes("trigger.leave"), true);
});

test("unl-172-219 LeBlanc, Fragmented: [Deathknell] executes trigger.leave against the killed incarnation (808.1.d)", () => {
  const definition = keywordDefinitionsById.get("Deathknell");
  const [expansion] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const kernel = world().unit("leblanc", { owner: "A", controller: "A" }).build();
  const source = kernel.getObject("leblanc");
  const scoped = kernel.clone({ sourceSnapshot: source, controller: "A", timingPoint: "object-killed" });
  scoped.perform({ type: "kill", object: scoped.ref("leblanc") });
  const outcome = resolveChainBody(expansion.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].op, "trigger.leave");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.leave, source.ref);
  assert.deepEqual(outcome.results[0].result.linkedValues.leaveSource.location, source.location);
});

test("unl-172-219 LeBlanc, Fragmented golden: CardProgram triggers register through the merged binding", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const board = fixture({
    cards: [{ id: "leblanc", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Order"], might: 3 }]
  });
  const source = { ...board.kernel.getObject("leblanc"), cardId: CANONICAL_ID, zone: "board" };
  const ids = binding.registerProgramTriggers(board.engine, source);
  assert.equal(ids.length, 2);
  assert.ok(ids.every(id => id.startsWith("program:leblanc:1:")));
});

test.todo(
  "unl-172-219 LeBlanc, Fragmented: read the controller's Beginning Phase at resolution (383.2.a.1/367) " +
    "so the draw branches stop resolving as ignored instructions and 'draw 2 instead' can be distinguished"
);
test.todo(
  "unl-172-219 LeBlanc, Fragmented: [Deathknell] keyword expansion (808.1.d.1 replaced death leaves the chain, " +
    "808.1.d.2/.d.3 last-known info before the zone change) — the registered KeywordDef still references " +
    "the unregistered trigger.leave primitive"
);
test.todo(
  "unl-172-219 LeBlanc, Fragmented: [Assault] expansion consumer (807.1.c attacker designation, contract 3.8 " +
    "combatRole) so the keyword actually grants +1 Might while attacking"
);
