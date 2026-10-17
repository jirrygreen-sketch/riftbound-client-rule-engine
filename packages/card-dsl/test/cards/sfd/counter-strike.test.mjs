import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/counter-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import prevent from "../../../../engine-core/dist/effects/instructions/replacement.prevent.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [keyword, play] = program.abilities;
const preventInstruction = play.body[0];
const drawInstruction = play.body[1];

test("Counter Strike program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-c6634bd393cadc3a20eda81ee688c8d171d215f7dd6297a92a55a2491f3ec43a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.prevent/);
  assert.match(program.judgeReason, /392/);
  // The stale "RIFT-86/89 cost" wording must not persist: the remaining gap is
  // production context forwarding and target incarnation tracking.
  assert.match(program.judgeReason, /ResolveContext\.replacement/);
  assert.match(program.judgeReason, /zoneEntryId/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Choose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Counter Strike structure: [Reaction], printed cost, targeted one-shot prevention, unlinked draw", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["counter-strike.prevent", "replacement.prevent"],
      ["counter-strike.draw", "effect.draw"]
    ]
  );

  // "Choose a unit" is a target (355.10.c). The shield is the "next time"
  // window of 392 and covers damage only (369.2 / 467.2.c.10).
  assert.deepEqual(preventInstruction.args.event, { kind: "constant", value: "damage" });
  assert.deepEqual(preventInstruction.args.scope, {
    kind: "constant",
    value: "one-shot-this-turn"
  });
  assert.deepEqual(preventInstruction.args.amount, { kind: "constant", value: "all" });
  assert.deepEqual(preventInstruction.args.target, {
    kind: "constant", value: { target: "counter-strike.unit" }
  });
  assert.equal(preventInstruction.targets.length, 1);
  const [target] = preventInstruction.targets;
  assert.equal(target.id, "counter-strike.unit");
  assert.deepEqual(target.filter, { type: "unit" });
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);

  // "Draw 1." is a separate sentence and stays unlinked (359.3.e.11).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("Counter Strike golden: the targeted unit is a legal damage target while the shield is modelled", () => {
  // 467.2.c.10 uses this card as its example: the shield is a replacement
  // effect, and the unit can still be dealt damage. Without an installed
  // shield the target remains actionable by effect.damage.
  const kernel = world().unit("shielded", { owner: "A", might: 5 }).build();
  const locked = kernel.ref("shielded");
  const run = runInstruction(damage, { amount: { kind: "constant", value: 2 }, target: "counter-strike.unit" }, {
    world: kernel,
    targets: { "counter-strike.unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("shielded").damage, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("Counter Strike: the card never approximates the shield with a state or damage rewrite", () => {
  // Durable data-level guard (independent of which engine pieces are merged):
  // the one-shot prevention is a replacement effect, so the program may only
  // declare the shield instruction plus the independent draw; it must not
  // hand-resolve prevention by dealing negative damage, healing, or mutating
  // state on its own.
  const ops = play.body.map((instruction) => instruction.op);
  assert.deepEqual(ops, ["replacement.prevent", "effect.draw"]);
  assert.equal(ops.includes("effect.heal"), false);
  assert.equal(ops.includes("effect.damage"), false);
});

test("Counter Strike golden: the independent Draw 1 draws one card", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Counter Strike shield expires after a real turn transition and never follows a target's new zone entry " +
    "(CR 124/392; requires production replacement context and zoneEntryId target binding)"
);

function preventionFixture() {
  const f = fixture({ cards: [{
    id: "counter-strike", cardId: program.canonicalCardId, types: ["spell"], energy: 2, power: ["Calm"]
  }] });
  f.kernel.setTargets("counter-strike.unit", [f.kernel.ref("enemy")]);
  const replacement = {
    host: {
      object: ref => f.kernel.object(ref),
      objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, "chain-item-resolve")
    },
    pipeline: f.engine.pipeline
  };
  // Supply the primitive's documented runtime extension to a real context.
  // Production instructionContext does not yet forward this extension.
  const context = bindResolveContext(
    f.host.context(f.kernel.getObject("counter-strike"), "A", "chain-item-resolve"),
    { replacement }
  );
  return { ...f, context };
}

test("Counter Strike golden: the merged primitive shields only the locked unit, once", () => {
  const { engine, kernel, context } = preventionFixture();
  assert.equal(instructionDefinitionsById.get(preventInstruction.op), prevent);
  const run = prevent.execute(context, prevent.argsSchema.parse(preventInstruction.args));
  assert.equal(run.status, "executed");
  assert.deepEqual(run.events, []);
  assert.equal(run.linkedValues.duration, "next-time-this-turn");
  assert.equal(run.linkedValues.amount, "all");
  assert.equal(typeof run.linkedValues.replacementId, "string");

  const damageAction = (id, amount) => ({
    type: "damage", source: kernel.ref("source"), target: kernel.ref(id), amount, combat: false
  });
  // Damage to another unit must neither be prevented nor consume the shield.
  assert.equal(engine.commit(damageAction("source", 1)).status, "done");
  assert.equal(kernel.getObject("source").damage, 1);
  const before = kernel.events.length;
  assert.equal(engine.commit(damageAction("enemy", 2)).status, "prevented");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events.slice(before), []);
  assert.equal(engine.commit(damageAction("enemy", 2)).status, "done");
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.deepEqual(kernel.events.slice(before).map(event => event.action), ["damage"]);
});

test("Counter Strike: the original play body still needs production replacement context forwarding", () => {
  const { engine, kernel, context } = preventionFixture();
  const before = kernel.objects;
  const hand = kernel.player("A").handSize;
  assert.throws(() => resolveChainBody(play.body, context), {
    name: "BlockedReplacementError",
    message: /requires ResolveContext\.replacement dependencies/
  });
  assert.deepEqual(kernel.objects, before);
  assert.equal(kernel.player("A").handSize, hand);
  assert.deepEqual(engine.pipeline.events, []);
});

test("Counter Strike golden: a departed target ignores prevention but the original body still draws", () => {
  const { engine, kernel, context } = preventionFixture();
  engine.commit({ type: "move-zone", object: kernel.ref("enemy"), to: "trash" });
  const hand = kernel.player("A").handSize;
  const deck = kernel.player("A").deckSize;
  const run = resolveChainBody(play.body, context);
  assert.equal(run.status, "partial");
  assert.deepEqual(run.results.map(({ id, result }) => [id, result.status]), [
    [preventInstruction.id, "ignored"], [drawInstruction.id, "executed"]
  ]);
  assert.equal(run.results[0].result.reason, "mistargeted");
  assert.equal(run.linkedValues["counter-strike.draw.drawn"], 1);
  assert.equal(kernel.player("A").handSize, hand + 1);
  assert.equal(kernel.player("A").deckSize, deck - 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test.todo(
  "Counter Strike end-to-end: [Reaction] timing admission on the chain, the target locked at " +
    "Finalize, the one-shot prevention consumed by the first damage event, and the independent " +
    "Draw 1 resolving (813 / 355.8 / 359.3.e.11)"
);
