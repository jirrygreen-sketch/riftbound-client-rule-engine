import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/stellacorn-herder.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-00a882b72ff4d8c644400fb6de458749cbdda6c6b7141ca71544931161253781";
const SOURCE_TEXT = "When I move, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("sfd-048-221 Stellacorn Herder: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-048-221 Stellacorn Herder: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /fromKind|fromLocationId/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-048-221 Stellacorn Herder: object-moved self trigger with one draw of 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 458: a Move, not a Recall.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "stellacorn-herder.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  // 414.3: printed "Draw 1"; the drawer defaults to the ability controller (190.6.d).
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
});

test("sfd-048-221 Stellacorn Herder golden: the body draws the top card through the interpreter", () => {
  const kernel = world().unit("stellacorn", { might: 3 }).deck(["deep", "top"]).build();
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["stellacorn-herder.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  // An array deck block is listed top-to-bottom, so "deep" is the top card.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deep"]);
  assert.equal(outcome.linkedValues["stellacorn-herder.draw-1.drawn"], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("sfd-048-221 Stellacorn Herder golden: an empty Main Deck links the actual count of 0 (414.4)", () => {
  const kernel = world().unit("stellacorn", { might: 3 }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-048-221 Stellacorn Herder: the merged program binding resolves the self anchor to this card", () => {
  // RIFT-257：translateTriggerFilter 把内层锚点 filter: { source: "self" } 解析成被移动
  // 对象的 objectId 锚点，因此「是本卡在移动」的同一性已由已合入的绑定消费，
  // 不再是 judgeReason 里的缺口。
  const translated = translateTriggerFilter(ability.trigger.filter, "stellacorn", "object-moved");
  assert.deepEqual(translated, {
    event: "object-moved",
    object: { objectId: "stellacorn" }
  });
});
