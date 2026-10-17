import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import discipline from "../../../dist/cards/ogn/discipline.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a1b14db94434084b789c0069291250652a46b455cbb2b5c347c9231af8ac51b5";

const [keyword, play] = discipline.abilities;
const [mightInstruction, drawInstruction] = play.body;

test("Discipline program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(discipline);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Discipline identity, ruleset, status and printed text", () => {
  assert.equal(discipline.canonicalCardId, CANONICAL);
  assert.equal(discipline.rulesetVersion, "core-1.5");
  assert.equal(discipline.status, "executable");
  assert.equal(discipline.judgeReason, undefined);
  assert.equal(cardRegistryById.get(discipline.canonicalCardId), discipline);
  assert.equal(
    discipline.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Give a unit +2 :rb_might: this turn. Draw 1."
  );
});

test("Discipline keeps the printed [Reaction] keyword (CR 813)", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
});

test("Discipline body: +2 Might this turn to one unit target, then an unlinked Draw 1", () => {
  assert.equal(play.body.length, 2);
  assert.equal(mightInstruction.id, "grant-plus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, { kind: "constant", value: { kind: "target", id: "chosen-unit" } });
  assert.deepEqual(mightInstruction.targets, [
    {
      id: "chosen-unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  assert.equal(drawInstruction.id, "draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  // "Draw 1." is a separate sentence and must not be gated on the Might half
  // (359.3.e.11: the spell resolves as much as possible).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("Discipline golden: the Draw 1 half really draws the top card", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});

test("Discipline golden: the Might clause registers +2 on the chosen unit until end of turn", () => {
  const kernel = world().deck(["top-card"]).unit("chosen-unit", { might: 3 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("chosen-unit") });
  scoped.setTargets("chosen-unit", [scoped.ref("chosen-unit")]);
  const outcome = runAbilityBody([mightInstruction], scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.filter.objectId, "chosen-unit");
  assert.equal(scoped.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(scoped.getObject("chosen-unit").buffs, 0);
});

test("Discipline golden: the complete play body grants Might and draws one card", () => {
  const kernel = world().unit("chosen-unit", { owner: "B", controller: "B", might: 3 }).deck("top-card").build();
  kernel.setTargets("chosen-unit", [kernel.ref("chosen-unit")]);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.result.status), ["executed", "executed"]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});
