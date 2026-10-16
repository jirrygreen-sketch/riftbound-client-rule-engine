// Golden test for Mordekaiser, Twice Slain (rad-020-167).
//
// The card is judge-required (see the program's judgeReason): the printed
// "you may … instead" optionality has no IR home, the "kill a friendly unit"
// within-instruction cost needs a filter-based non-target cost selection, and
// Recall is explicitly blocked by effect.move. The runnable evidence is the
// three merged primitives of the replacement body (effect.kill via picks,
// effect.heal, effect.exhaust).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mordekaiser-twice-slain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";

const CANONICAL =
  "card.hash-f7168f36176ada340afa90fee63698e923fee7c44c455b65ba0fa4cf1b747c7e";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
  "Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead.";
const HOST = { canonicalCardId: CANONICAL };

const [accelerateKeyword, assaultKeyword, replacement] = program.abilities;
const [killInstruction, healInstruction, exhaustInstruction, recallInstruction] = replacement.with;

test("rad-020-167 Mordekaiser, Twice Slain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-020-167 Mordekaiser, Twice Slain: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason must name the missing semantics and the owner tasks.
  assert.match(program.judgeReason, /optional/);
  assert.match(program.judgeReason, /ReplacementAbility/);
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.match(program.judgeReason, /recall/i);
  assert.match(program.judgeReason, /RIFT-109/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-020-167 Mordekaiser, Twice Slain: Accelerate + Assault 3 declared in printed order", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerateKeyword, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(assaultKeyword, { kind: "keyword", keyword: "assault", value: 3 });
  // CR 807.2 / 805: both keywords' values live on the keyword declarations.
  assert.equal(keywordDefinitionsById.get("Accelerate"), accelerate);
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  assert.equal(assault.stacking, "sum");
  assert.ok(accelerate.ruleRefs.includes("805.1.b"));
  assert.ok(assault.ruleRefs.includes("807.1.c"));
});

test("rad-020-167 Mordekaiser, Twice Slain: the replacement intercepts its own death", () => {
  assert.equal(replacement.kind, "replacement");
  // "if I would die" — the replaced event is this source unit being killed (429.1).
  assert.deepEqual(replacement.replaces, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(replacement.with.length, 4);
  assert.deepEqual(
    replacement.with.map((instruction) => instruction.id),
    [
      "mordekaiser.kill-friendly",
      "mordekaiser.heal-self",
      "mordekaiser.exhaust-self",
      "mordekaiser.recall-self"
    ]
  );
});

test("rad-020-167 Mordekaiser, Twice Slain: 'kill a friendly unit' is a non-target pick (355.10.c.1)", () => {
  assert.equal(killInstruction.op, "effect.kill");
  // 355.10.c.1: "[do X] to [do Y]" costs inside an instruction do not target.
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "mordekaiser.friendly-unit" }
  });
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks.length, 1);
  const [pick] = killInstruction.picks;
  assert.equal(pick.id, "mordekaiser.friendly-unit");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
  assert.deepEqual(pick.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    other: true
  });
});

test("rad-020-167 Mordekaiser, Twice Slain: heal me → exhaust me → recall me, in printed order", () => {
  // "heal me" (419.1) — effect.heal's default selection is the ability source.
  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args, {});
  assert.equal(healInstruction.linkedTo, "mordekaiser.kill-friendly");

  // "exhaust me" (415.1) — the source is anchored symbolically, never as a target.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.deepEqual(exhaustInstruction.args.choose, {
    kind: "constant",
    value: { id: "mordekaiser.exhaust-me", filter: { source: "source" } }
  });
  assert.equal(exhaustInstruction.linkedTo, "mordekaiser.heal-self");

  // "recall me instead" (457/458/458.3/460.1) — declared, blocked by the primitive.
  assert.equal(recallInstruction.op, "effect.move");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.equal(recallInstruction.linkedTo, "mordekaiser.exhaust-self");
});

test("rad-020-167 Mordekaiser, Twice Slain: kill + heal + exhaust really resolve through the interpreter", () => {
  const kernel = world()
    .unit("mordekaiser", { might: 5, damage: 3 })
    .unit("ally", { might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  scoped.setPicks("mordekaiser.friendly-unit", [scoped.ref("ally")]);

  // Drop the declared TargetSpec and drive the three merged primitives; the
  // recall instruction is excluded because its op is declared but blocked.
  const body = replacement.with.slice(0, 3).map(({ targets, picks, ...rest }) => rest);
  const outcome = runAbilityBody(body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["mordekaiser.kill-friendly", "executed"],
      ["mordekaiser.heal-self", "executed"],
      ["mordekaiser.exhaust-self", "executed"]
    ]
  );
  // 429.1: the friendly unit really dies; 419.1 clears the marked damage on Mordekaiser.
  assert.equal(scoped.getObject("ally").zone, "trash");
  assert.equal(scoped.getObject("mordekaiser").damage, 0);
  // 415.1: the source is exhausted; the unrelated enemy unit is untouched.
  assert.equal(scoped.getObject("mordekaiser").exhausted, true);
  assert.equal(scoped.getObject("enemy").exhausted, false);
});

test("rad-020-167 Mordekaiser, Twice Slain: an already-exhausted source stays exhausted with no extra action (415.1.c)", () => {
  const kernel = world().unit("mordekaiser", { might: 5, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  // Only the exhaust step runs here, so the printed linkedTo is dropped: the
  // interpreter rejects a link to an instruction that is not in this body.
  const outcome = runAbilityBody([{ ...exhaustInstruction, linkedTo: undefined }], scoped);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues["exhausted"].alreadyExhausted, 1);
  assert.equal(scoped.getObject("mordekaiser").exhausted, true);
});

test("rad-020-167 Mordekaiser, Twice Slain: the recall step is still blocked by the frozen action set (457-460)", () => {
  const kernel = world().unit("mordekaiser", { might: 5 }).build();
  const sourceRef = kernel.ref("mordekaiser");
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: "source" },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" }
    },
    { world: kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") }) }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // The receipt names the missing distinct Recall action and performs nothing.
  assert.match(run.linked.moved.blockedReason, /Recall requires an action distinct from Move/);
  assert.equal(run.linked.moved.count, 0);
  assert.deepEqual(run.linked.moved.objects, []);
  // The program names the same step for the same symbolic source.
  assert.deepEqual(recallInstruction.args.objects, { kind: "constant", value: "source" });
  assert.equal(sourceRef.zoneEntryId, 1);
});

test.todo(
  "Mordekaiser, Twice Slain: the printed 'you may … instead' optional replacement (369.1/368.1) — blocked because " +
    "ReplacementAbility has no optional field and the card-level replacement registration path is unmerged (RIFT-120); " +
    "writing choice.optional inside the body would replace the death even when declined"
);

test.todo(
  "Mordekaiser, Twice Slain: 'kill a friendly unit' as a within-instruction cost selection (355.10.c.1) — blocked because " +
    "CostSpec choices require exact ObjectRefs (cost/plan-values.ts choiceObjects) and cost.sacrifice / cost.pay are unmerged (RIFT-89)"
);

test.todo(
  "Mordekaiser, Twice Slain: 'recall me instead' as a real Recall (457-460) — blocked because effect.move rejects mode \"recall\" " +
    "(the frozen move-location action cannot distinguish Recall from Move) and the kernel has no Recall action (RIFT-109)"
);

test.todo(
  "Mordekaiser, Twice Slain: [Accelerate] (805) and [Assault 3] (807.1.c, +3 while attacker) expansions — the KeywordDefs are merged " +
    "(RIFT-86/RIFT-81) but no producer resolves a card's keyword abilities into them and registers the layers (RIFT-91), and the " +
    "Attacker designation is not yet an ObjectSnapshot characteristic (contract 3.8)"
);

test.todo(
  "Mordekaiser, Twice Slain: the 'Once each turn' one-shot lifetime on the replacement — blocked because the replacement " +
    "registration path does not model card-level once-per-turn windows (RIFT-120)"
);
