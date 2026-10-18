import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-dreaming-tree.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a1fe32c7a5d6ccb45f7a6ad5b46788ec7aef047cd24e116d3ffa028b28a7f1c8";
const SOURCE_TEXT =
  "When a player chooses a friendly unit here with a spell for the first time each turn, they draw 1.";

const [ability] = program.abilities;
const [draw] = ability.body;

test("The Dreaming Tree program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383\.4\.b/);
  assert.match(program.judgeReason, /触发注册路径已存在/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /载荷|chooser/);
  assert.ok(!/RIFT-357/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("The Dreaming Tree structure: targeting effect, once per turn, draw for the chooser", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);

  // 383.4.b: a Targeting Effect subscribes to the became-target timing point.
  assert.equal(ability.trigger.at, "became-target");
  assert.deepEqual(ability.trigger.filter, {
    event: "became-target",
    target: { type: "unit", sameLocationAs: "self" },
    source: { type: "spell" },
    player: "any"
  });
  // 383.3.e / 383.3.e.1: "for the first time each turn" is the per-turn lifetime.
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 1);
  assert.equal(draw.id, "dreaming-tree.draw");
  assert.equal(draw.op, "effect.draw");
  // 414.3: exactly one card, drawn by the player who did the choosing (the
  // trigger payload binding that is still missing supplies that player).
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(draw.args.pick, { kind: "constant", value: "dreaming-tree.chooser" });
  assert.equal(draw.targets, undefined);
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.condition, undefined);

  // The drawer is a non-target pick (355.7: a pick is not a target and must not
  // fire target-related triggers).
  assert.equal(draw.picks.length, 1);
  assert.deepEqual(draw.picks[0], {
    id: "dreaming-tree.chooser",
    options: ["choosing-player"],
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("The Dreaming Tree golden: the body draws for the triggering player, not the ability controller", () => {
  const kernel = world().deck("b-deck-card", { owner: "B" }).build();
  kernel.setPicks("dreaming-tree.chooser", ["B"]);

  // The kernel's controller is "A"; the bound chooser is "B", so the draw goes
  // to B's Main Deck and B's hand.
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["dreaming-tree.draw", "executed"]
  ]);
  assert.deepEqual(outcome.results[0].result.linkedValues, { drawn: 1, drawnTo: "B" });
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b-deck-card"]);
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
});

test("The Dreaming Tree golden: an unbound chooser negates the draw instead of drawing for the wrong player", () => {
  const kernel = world().deck("b-deck-card", { owner: "B" }).build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.equal(kernel.zone("B", "hand").length, 0);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "The Dreaming Tree trigger payload binding: 'they draw 1' must resolve the choosing " +
    "player's controller from the became-target event (383.4.b.2); the existing registration " +
    "path still needs to bind that event payload into the body"
);

test.todo(
  "The Dreaming Tree scope: 'a friendly unit here with a spell' needs the 053.3 'here' " +
    "referent in the trigger translator/matcher (programs/filters.ts currently rejects " +
    "sameLocationAs), the chooser-relative 'friendly' check, and 190.6's controller of the " +
    "Battlefield ability"
);
