import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/counter-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
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
  assert.match(program.judgeReason, /371\.1/);
  // The stale "RIFT-86/89 cost" wording must not persist: the remaining gap is
  // the one-shot damage-prevention replacement form.
  assert.match(program.judgeReason, /registerReplacement/);
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
  // window of 371.1 and covers damage only (367 / 444 for replacement rules).
  assert.deepEqual(preventInstruction.args.event, { kind: "constant", value: "damage" });
  assert.deepEqual(preventInstruction.args.scope, {
    kind: "constant",
    value: "one-shot-this-turn"
  });
  assert.deepEqual(preventInstruction.args.amount, { kind: "constant", value: "all" });
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
  // effect, and the unit is still dealt damage. Until replacement.prevent is
  // merged the golden test only proves the target/instruction shape is
  // actionable by the merged effect.damage primitive.
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
  "Counter Strike shield: the next time the chosen unit would be dealt damage this turn the " +
    "damage is prevented, and only the first such event is prevented (CR 367-371, 371.1; " +
    "467.2.c.10 keeps the unit able to be dealt damage) " +
    "(依赖 replacement.prevent 原语与替代效果拦截渠道)"
);

test.todo(
  "Counter Strike end-to-end: [Reaction] timing admission on the chain, the target locked at " +
    "Finalize, the one-shot prevention consumed by the first damage event, and the independent " +
    "Draw 1 resolving (813 / 355.8 / 359.3.e.11)"
);
