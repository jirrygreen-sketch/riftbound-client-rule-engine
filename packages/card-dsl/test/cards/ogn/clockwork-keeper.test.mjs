import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/clockwork-keeper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-de653e6834bc37f0789f5440ed9c70c08e828432f917783a5f0277fa9ceed1a0";
const SOURCE_TEXT =
  "As you play me, you may pay :rb_rune_calm: as an additional cost. If you do, draw 1.";

const play = program.abilities[0];
const drawInstruction = play.body[0];

test("ogn-044-298 Clockwork Keeper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-044-298 Clockwork Keeper: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  // The still-current gaps: no CardProgram cost binding (RIFT-257) and no
  // cost.pay instruction / receipt (RIFT-261), plus the missing cost-result
  // condition source.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-044-298 Clockwork Keeper: the optional additional cost is declared as one Calm power", () => {
  // 356.2.b / 356.2.b.1: "as an additional cost" + "may" = Optional Additional
  // Cost, paid during the play steps (355.1.a). The card prints no Power cost
  // (power: null in the catalog) — this is a separate, optional component.
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, true);
  assert.deepEqual(play.cost.power, { kind: "constant", value: ["Calm"] });
  assert.equal(play.cost.energy, undefined);
});

test("ogn-044-298 Clockwork Keeper: body is the single conditional Draw 1", () => {
  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.id, "clockwork-keeper.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("ogn-044-298 Clockwork Keeper golden: Draw 1 moves the top card of the deck to hand", () => {
  const kernel = world().deck(["bottom-card", "top-card"], { owner: "A" }).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-044-298 Clockwork Keeper golden: Draw 1 with an empty deck draws as much as possible (CR 414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

// ---------------------------------------------------------------------------
// Not executable — TODO items with real causes (see judgeReason).
// ---------------------------------------------------------------------------

test.todo(
  "ogn-044-298 Clockwork Keeper: the optional additional cost cannot be charged from the card: the " +
    "merged cost pipeline consumes only caller-supplied CostPlanInput (cost/cost-plan.ts " +
    "optionalAdditional), the CardProgram cost binding is unmerged (RIFT-257), and " +
    "effects/instructions/ has no cost.additional / cost.pay primitive (RIFT-261)"
);

test.todo(
  "ogn-044-298 Clockwork Keeper: the 'If you do' gate needs the paid receipt (CR 356.4.f.1: " +
    "counted as paid by the decision, not by the amount actually paid); the frozen IR has no " +
    "cost-result binding (survey condition.result, 46 identities) so the draw cannot be gated"
);
