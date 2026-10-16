import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/poppy-paragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f5361ea4d4f46808730ef47f9575d7fc51b16c6cbcfb2659bca74cdd30b9baf2";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When you play me, if an opponent's score is within 3 points of the Victory Score, " +
  "ready me and gain 3 XP.";

const [deflect, playTrigger] = program.abilities;
const [readyInstruction, gainXp] = playTrigger.body;

test("unl-116-219 Poppy, Paragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-116-219 Poppy, Paragon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /Victory Score/);
  assert.match(program.judgeReason, /194\.3/);
  // The reason must refuse to hard-code the default Victory Score of 8.
  assert.match(program.judgeReason, /硬编码 8 就是臆造/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-116-219 Poppy, Paragon: [Deflect] stays a keyword declaration without a printed value (809.1.b.3)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
  // 809.1.b.3: an omitted Deflect value is treated as 1 by the keyword expansion.
  assert.notEqual(keywordDefinitionsById.get("Deflect"), undefined);
  assert.equal(keywordDefinitionsById.get("Deflect").valued, true);
});

test("unl-116-219 Poppy, Paragon: 'When you play me' is a mandatory card-played trigger on the source", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("unl-116-219 Poppy, Paragon: the if clause is the trigger condition, not an instruction condition", () => {
  // 383.2.a.1: the trailing “if …” belongs to the trigger condition and is
  // evaluated when the ability triggers. The Victory Score has no read path, so
  // the condition stays a named predicate instead of a hard-coded comparison.
  assert.deepEqual(playTrigger.trigger.condition, {
    kind: "expression",
    value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
  });
  assert.equal(playTrigger.body.length, 2);
  for (const instruction of playTrigger.body) assert.equal(instruction.condition, undefined);
});

test("unl-116-219 Poppy, Paragon: 'ready me and gain 3 XP' are two independent instructions", () => {
  assert.equal(readyInstruction.id, "poppy-paragon.ready-self");
  assert.equal(readyInstruction.op, "effect.ready");
  // 355.10.g: “me” is the ability's source, so the default source selection is used.
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.linkedTo, undefined);

  assert.equal(gainXp.id, "poppy-paragon.gain-3-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 3 } });
  assert.equal(gainXp.args.player, undefined);
  // “ready me and gain 3 XP” is one sentence with two clauses: neither clause
  // references the other's action, so they are not linked (359.3.e.14).
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(gainXp.targets, undefined);
});

test("unl-116-219 Poppy, Paragon golden: the body readies the source and gains 3 XP", () => {
  const base = world().unit("poppy", { exhausted: true, might: 5 }).build();
  // The interpreter binds the source selector to the host/source reference the
  // caller supplies (interpreter README); the card-played trigger supplies the
  // entered permanent, which is this unit. The reference kernel's scenario is
  // started by the exhaustion of the just-played unit (359.2.c).
  const kernel = base.clone({ source: base.ref("poppy"), sourceSnapshot: base.getObject("poppy") });
  assert.equal(kernel.getObject("poppy").exhausted, true);

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  // 416.1: the ready action clears the exhausted state.
  assert.equal(kernel.getObject("poppy").exhausted, false);
  // 730.1: gaining 3 XP increases the controller's marked XP.
  assert.equal(kernel.player("A").xp, 3);
  assert.equal(kernel.player("B").xp, 0);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["poppy-paragon.ready-self", "executed"],
    ["poppy-paragon.gain-3-xp", "executed"]
  ]);
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
  assert.equal(outcome.results[1].result.linkedValues.gained, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready", "gain-xp"]);
});

test("unl-116-219 Poppy, Paragon golden: an already-ready unit is not readied again (416.1.b/416.1.c)", () => {
  const base = world().unit("poppy", { exhausted: false, might: 5 }).build();
  const kernel = base.clone({ source: base.ref("poppy"), sourceSnapshot: base.getObject("poppy") });

  const outcome = resolveChainBody(playTrigger.body, kernel);

  // Already ready: nothing additional happens, the instruction still executes
  // (416.1.b/416.1.c) and the XP half is unaffected (359.3.e.11).
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.equal(kernel.getObject("poppy").exhausted, false);
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-116-219 Poppy, Paragon golden: a lost source negates the ready half but the XP half still resolves (359.3.e.11)", () => {
  // The source reference is old (the unit left its zone), so effect.ready is
  // ignored as mistargeted; the independent XP clause still resolves.
  const base = world().unit("poppy", { exhausted: true, might: 5 }).build();
  const stale = base.getObject("poppy");
  const kernel = base.clone({ sourceSnapshot: stale });
  kernel.addObject({ ...stale, ref: { id: "poppy", zoneEntryId: stale.ref.zoneEntryId + 1 } }, "board");
  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test.todo(
  "unl-116-219 Poppy, Paragon: [Deflect] taxes opponents' targeting with one any-domain Power " +
    "(CR 809.1.c/809.1.c.1) — no producer wires the target.tax layer effect into TargetPlan/costs and the merged " +
    "tax conversion bills Energy (RIFT-84, RIFT-89/RIFT-90; same gap as sfd/navori-scout)"
);
test.todo(
  "unl-116-219 Poppy, Paragon: evaluate “an opponent's score is within 3 points of the Victory Score” against the " +
    "live Victory Score (CR 194.3/194.3.a) — no victoryScore read path exists and the default 8 must not be hard-coded"
);
test.todo(
  "unl-116-219 Poppy, Paragon: register the card-played trigger as a TriggerRegistration (RIFT-120 follow-up)"
);
