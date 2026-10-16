import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lilting-lullaby.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0fd730fbefcd79781194c269d2e2a4c9e610d42a403c6f112d892d3bf8f1a3fe";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Counter a spell. Its controller can't play spells this turn.";

const [reactionKeyword, play] = program.abilities;
const [counterSpell, noSpells] = play.body;
const spellTargetSpec = counterSpell.targets[0];

// The reference kernel compares filter values literally, so the chain-spell
// target is supplied through Finalize in production and directly here; the
// authored TargetSpec stays asserted structurally above.
const bodyWithoutTargetSpecs = play.body.map(({ targets, ...rest }) => rest);

test("unl-190-219 Lilting Lullaby: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-190-219 Lilting Lullaby: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The unresolved part is the prohibition's consumer and the referent that
  // names the player it applies to.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /359\.3\.f\.1/);
  // The counter half cites the rule entries that make the chain spell a legal
  // target and exclude self-targeting and pending items.
  assert.match(program.judgeReason, /426\.1/);
  assert.match(program.judgeReason, /355\.9\.a\.2/);
  assert.match(program.judgeReason, /355\.9\.c/);
});

test("unl-190-219 Lilting Lullaby: [Reaction] plus a chain-spell counter target and an independent prohibition", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["lilting-lullaby.counter-spell", "lilting-lullaby.no-spells"]
  );

  // 355.9.a.2: "spell" means a finalized object on the Chain; 355.9.c keeps a
  // spell from targeting itself and contract 3.4 excludes Pending items. Both
  // are the target system's Finalize obligations, not card data.
  assert.equal(counterSpell.op, "effect.counter");
  assert.deepEqual(counterSpell.args.target, {
    kind: "constant",
    value: "lilting-lullaby.spell"
  });
  assert.deepEqual(counterSpell.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(spellTargetSpec, {
    id: "lilting-lullaby.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(counterSpell.linkedTo, undefined);

  // "Its controller can't play spells this turn" is a separate instruction (no
  // do-X-to-Y dependency, 055 / 359.3.e.11), so it is not linked. The chooser
  // of the prohibition is the countered spell's controller referent
  // (359.3.f.1); the consumer itself is the judged gap.
  assert.equal(noSpells.op, "continuous.restrict");
  assert.equal(noSpells.linkedTo, undefined);
  assert.equal(noSpells.targets, undefined);
  assert.deepEqual(noSpells.args.mode, { kind: "constant", value: "prohibit" });
  assert.deepEqual(noSpells.args.action, { kind: "constant", value: "play-spell" });
  assert.deepEqual(noSpells.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(noSpells.args.appliesTo, {
    kind: "object-property",
    object: { target: "lilting-lullaby.spell" },
    property: "controller"
  });
});

test("unl-190-219 Lilting Lullaby golden: effect.counter really clears the chain spell and links the countered object", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [kernel.ref("spell")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  // 426.2: a countered spell does nothing and leaves the Chain; the kernel
  // routes it to Trash and does not refund any cost.
  assert.equal(kernel.getObject("spell").zone, "trash");
  assert.deepEqual(run.linked.counteredObjects.map((ref) => ref.id), ["spell"]);
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
});

test("unl-190-219 Lilting Lullaby golden: the counter half really runs through the interpreter", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const ctx = kernel.clone();
  ctx.setTargets("lilting-lullaby.spell", [ctx.ref("spell")]);

  // Only the merged half is executed here: the prohibition clause has no
  // registered primitive (judgeReason), and the interpreter reports an unknown
  // opcode instead of silently discarding it - asserted separately below.
  const outcome = resolveChainBody([bodyWithoutTargetSpecs[0]], ctx);

  assert.equal(outcome.status, "executed");
  assert.equal(ctx.getObject("spell").zone, "trash");
  const counterResult = outcome.results.find((result) => result.id === "lilting-lullaby.counter-spell");
  assert.equal(counterResult.result.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
});

test("unl-190-219 Lilting Lullaby golden: the prohibition clause carries the reviewed declarative shape only", () => {
  // Whether the prohibition is executable depends on the unmerged
  // continuous.restrict consumer (judgeReason), so this test only pins the
  // declared shape and leaves the execution evidence to the TODO below; no
  // no-op closure stands in for the effect.
  assert.equal(bodyWithoutTargetSpecs[1].op, "continuous.restrict");
  assert.deepEqual(bodyWithoutTargetSpecs[1].args.action, {
    kind: "constant",
    value: "play-spell"
  });
  assert.deepEqual(bodyWithoutTargetSpecs[1].args.duration, {
    kind: "constant",
    value: "this-turn"
  });
});

test("unl-190-219 Lilting Lullaby golden: a countered spell keeps its printed cost unrefunded", () => {
  // 426.3: countering does not refund costs. The kernel models the card in
  // Trash; no energy is returned to its controller here.
  const kernel = world()
    .player("B", { energy: 0 })
    .unit("spell", { owner: "B", types: ["spell"], zone: "chain" })
    .build();
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [kernel.ref("spell")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").energy, 0);
  assert.equal(kernel.getObject("spell").zone, "trash");
});

test("unl-190-219 Lilting Lullaby golden: a stale chain reference is mistargeted instead of countered", () => {
  const kernel = world().unit("spell", { owner: "B", types: ["spell"], zone: "chain" }).build();
  const stale = kernel.ref("spell");
  // The spell resolved and left the Chain before this instruction resolves.
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  const run = runInstruction(
    counter,
    { target: "lilting-lullaby.spell", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "lilting-lullaby.spell": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-190-219 Lilting Lullaby: register the this-turn \"can't play spells\" prohibition and consume it from the chain's canAct timing query (CR 355.8 / 806 / 159.2; no continuous.restrict primitive or consumer - RIFT-91 plus the chain permission query)"
);
test.todo(
  "unl-190-219 Lilting Lullaby: resolve \"Its controller\" as the countered spell's controller referent and expire the prohibition at the end-of-turn timing point (CR 359.3.f.1; RIFT-91)"
);
test.todo(
  "unl-190-219 Lilting Lullaby: enforce the printed [Reaction] Closed-State permission and the target legality rules (355.9.a.2 / 355.9.c / contract 3.4 pending-item exclusion) in the production chain (RIFT-90/RIFT-120)"
);
