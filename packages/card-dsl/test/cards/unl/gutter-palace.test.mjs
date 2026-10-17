import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gutter-palace.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-bcbe9b5d738a83a45e624acaf6d4f8ec5125c1fc1bc5704e46f6776a7abae109";
const SOURCE_TEXT =
  "At the start of your Beginning Phase, if you have exactly 4 cards in hand and exactly 4 units at battlefields, you win the game.\n" +
  "Discard 1, :rb_exhaust:: Play a 1 :rb_might: Bird unit token with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)";

const [triggered, activated] = program.abilities;
const [win] = triggered.body;
const [playBird] = activated.body;

test("unl-088-219 Gutter Palace: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-088-219 Gutter Palace: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /LocationSelector|LocationExpr/);
  assert.match(program.judgeReason, /argsSchema|适配/);
  assert.match(program.judgeReason, /PickSpec/);
  assert.match(program.judgeReason, /exact-count/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|102|120)/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-088-219 Gutter Palace: the win trigger is a beginning-start trigger with both exact counts in the trigger condition", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(triggered.kind, "triggered");
  // 315.2.a.1 / 383.2.a: at the start of your Beginning Phase.
  assert.equal(triggered.trigger.at, "beginning-start");
  assert.deepEqual(triggered.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(triggered.trigger.once, undefined);
  // 383.2.a.1: the trailing "if ..." clauses belong to the Trigger Condition.
  assert.equal(triggered.trigger.condition.kind, "all");
  assert.equal(triggered.trigger.condition.conditions.length, 2);
  assert.deepEqual(triggered.trigger.condition.conditions[0], {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-in-your-hand",
      filter: { zone: "hand", owner: "controller" }
    },
    operator: "eq",
    right: { kind: "constant", value: 4 }
  });
  assert.deepEqual(triggered.trigger.condition.conditions[1], {
    kind: "compare",
    left: {
      kind: "count",
      subject: "your-units-at-battlefields",
      filter: {
        zone: "board",
        type: "unit",
        controller: "controller",
        location: "battlefield"
      }
    },
    operator: "eq",
    right: { kind: "constant", value: 4 }
  });
  // No printed "may": the triggered ability is mandatory (383.3.a).
  assert.equal(triggered.optional, false);
});

test("unl-088-219 Gutter Palace: the win body is a bare effect.win for the ability controller", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(win.id, "gutter-palace.win");
  assert.equal(win.op, "effect.win");
  // 190.6.d: the omitted player is the ability controller; no seat is hard-coded.
  assert.deepEqual(win.args, {});
  assert.equal(win.targets, undefined);
  assert.equal(win.picks, undefined);
  assert.equal(win.linkedTo, undefined);
});

test("unl-088-219 Gutter Palace: the activated ability costs Discard 1 plus the exhaust symbol at action timing", () => {
  assert.equal(activated.kind, "activated");
  // 151 / 151.2: Gear activated abilities default to action speed in the Main Phase.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.kind, "activated");
  // 423 / 423.1 / 423.3: Discard 1 is a cost (the discarder chooses which card).
  assert.deepEqual(activated.cost.payments[0], {
    kind: "discard",
    choice: {
      id: "gutter-palace.discard-one",
      options: ["card-in-controller-hand"],
      min: 1,
      max: 1,
      selection: "one",
      filter: { zone: "hand", owner: "controller" }
    }
  });
  // 415.5: the exhaust symbol means "Exhaust this".
  assert.deepEqual(activated.cost.payments[1], { kind: "exhaust" });
  assert.equal(activated.cost.energy, undefined);
});

test("unl-088-219 Gutter Palace: the token instruction is the printed Bird play with no invented definition or location", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(playBird.id, "gutter-palace.play-bird-token");
  assert.equal(playBird.op, "effect.token");
  // 187.7: the Bird is a domainless 1 Might unit token with the Bird tag and
  // [Deflect]; the frozen definition table has no bird entry.
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  // 440.2.c / 185.2.a: "Play ... token" goes through chain creation.
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 355.2 / RIFT-357: the destination is a real LocationExpr selector.
  assert.deepEqual(playBird.args.location, {
    kind: "location",
    value: {
      kind: "choose",
      id: "gutter-palace.bird-location",
      filter: { type: "any", controller: "controller" }
    }
  });
  assert.deepEqual(Object.keys(playBird.args).sort(), ["amount", "location", "mode", "token"]);
  assert.equal(playBird.linkedTo, undefined);
  assert.equal(playBird.targets, undefined);
});

test("unl-088-219 Gutter Palace: the merged LocationSelector offers the controller Base and controlled battlefield", () => {
  const base = { type: "base", player: "A" };
  const ownBattlefield = { type: "battlefield", id: "bf-a" };
  const opponentBattlefield = { type: "battlefield", id: "bf-b" };
  const kernel = world()
    .unit("base-unit", { owner: "A", controller: "A", location: base })
    .unit("own-unit", { owner: "A", controller: "A", location: ownBattlefield })
    .object("bf-a", { types: ["battlefield"], zone: "board", location: null, owner: "A", controller: "A" })
    .unit("opponent-unit", { owner: "B", controller: "B", location: opponentBattlefield })
    .object("bf-b", { types: ["battlefield"], zone: "board", location: null, owner: "B", controller: "B" })
    .build();
  assert.throws(
    () => resolveLocationSelector(playBird.args.location.value, { context: kernel, players: ["A", "B"], opponent: "B" }),
    error => {
      assert.deepEqual(error.request.options, [base, ownBattlefield]);
      return true;
    }
  );
  kernel.setAnswers({ "gutter-palace.bird-location": ownBattlefield });
  assert.deepEqual(
    resolveLocationSelector(playBird.args.location.value, { context: kernel, players: ["A", "B"], opponent: "B" }),
    ownBattlefield
  );
});

test("unl-088-219 Gutter Palace golden: the merged effect.win declares the controller the winner through the interpreter", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["gutter-palace.win", "executed"]
  ]);
  assert.deepEqual(kernel.events.map(event => event.action), ["win"]);
});

test.todo(
  "unl-088-219 Gutter Palace: add the CR 187.7 Bird token (domainless, 1 Might, Bird tag, [Deflect] per 809) to the " +
    "effect.token definition table — definitions carrying their own keywords/abilities stay blocked"
);
test.todo(
  "unl-088-219 Gutter Palace: resolve the token's unprinted entry location (CR 355.2: the controller's Base or a " +
    "battlefield they control) through the merged LocationSelector; the remaining gap is the effect.token " +
    "interpreter/argsSchema adapter for the evaluated LocationExpr destination"
);
test.todo(
  "unl-088-219 Gutter Palace: pay 'Discard 1' from a Finalize-supplied exact hand reference (CR 423.1.a / 423.3; " +
    "the card-program activation adapter must supply the selected hand ObjectRef to the cost plan"
);
test.todo(
  "unl-088-219 Gutter Palace: evaluate the beginning-start exact-count condition in the production trigger host " +
    "(CR 315.2.a.1, 383.2.a.1); the registered trigger needs a query over the controller's hand and battlefield units"
);
