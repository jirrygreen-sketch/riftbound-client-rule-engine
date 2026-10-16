import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/evelynn-entrancing.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-650842dbdfc1ff881b1b846ecbefb168d4230c218aa64ca678d3a085546fd872";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Backline] (I must be assigned combat damage last.)\n" +
  "When you play me from face down on your turn, you may move an enemy unit at a different location " +
  "to my battlefield.";

const [hidden, backline, triggered] = program.abilities;
const [mayMove] = triggered.body;
const [lockBattlefield, moveEnemy] = mayMove.args.body.value;
const targetSpec = moveEnemy.targets[0];

function evesBoard() {
  const kernel = world()
    .unit("evelynn", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", {
      owner: "B",
      controller: "B",
      might: 4,
      location: { type: "battlefield", id: "bf-2" }
    })
    .unit("enemy-here", {
      owner: "B",
      controller: "B",
      might: 4,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return kernel.clone({ source: kernel.ref("evelynn"), sourceSnapshot: kernel.getObject("evelynn") });
}

test("unl-141-219 Evelynn, Entrancing: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-141-219 Evelynn, Entrancing: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /826\.3/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("unl-141-219 Evelynn, Entrancing: Hidden and Backline keywords plus the face-down play trigger", () => {
  assert.equal(program.abilities.length, 3);
  // 811.1 / 826.1: both are passive keywords; the card only declares them (contract 3.7 section 5).
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  // "you may move …" is the effect's leading may (not a cost), expressed inside the body via 3.9.
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.condition, undefined);
});

test("unl-141-219 Evelynn, Entrancing: the may node locks my battlefield before moving (CR 355.4)", () => {
  assert.equal(mayMove.id, "evelynn-entrancing.may-move");
  assert.equal(mayMove.op, "choice.optional");
  assert.equal(mayMove.linkedTo, undefined);
  assert.deepEqual(mayMove.args.prompt, {
    kind: "constant",
    value: "Move an enemy unit at a different location to my battlefield?"
  });
  assert.deepEqual(mayMove.args.body.value.map(step => [step.id, step.op]), [
    ["evelynn-entrancing.my-battlefield", "condition.value"],
    ["evelynn-entrancing.move-enemy", "effect.move"]
  ]);

  // 359.3.f: "my" is the source's current location, locked before the Move happens.
  assert.deepEqual(lockBattlefield.args.value, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.deepEqual(lockBattlefield.args.key, { kind: "constant", value: "myBattlefield" });
  assert.equal(lockBattlefield.targets, undefined);

  assert.equal(moveEnemy.linkedTo, "evelynn-entrancing.my-battlefield");
  assert.deepEqual(moveEnemy.args.objects, {
    kind: "constant",
    value: { target: "evelynn-entrancing.enemy-unit-elsewhere" }
  });
  assert.deepEqual(moveEnemy.args.to, {
    kind: "linked-value",
    instructionId: "evelynn-entrancing.my-battlefield",
    key: "myBattlefield"
  });
  assert.deepEqual(moveEnemy.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveEnemy.args.linkKey, { kind: "constant", value: "moved" });
  // "an enemy unit" is one opponent-controlled Board unit; "at a different location" needs the
  // unmerged location-negation anchor (see judgeReason).
  assert.deepEqual(targetSpec, {
    id: "evelynn-entrancing.enemy-unit-elsewhere",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(moveEnemy.picks, undefined);
});

test("unl-141-219 Evelynn, Entrancing: the declared keyword ids match the merged KeywordDefs", () => {
  const registeredHidden = keywordDefinitionsById.get("Hidden");
  const registeredBackline = keywordDefinitionsById.get("Backline");
  assert.ok(registeredHidden, "effects/keywords/Hidden.ts must be in the generated keyword registry");
  assert.ok(registeredBackline, "effects/keywords/Backline.ts must be in the generated keyword registry");
  assert.equal(hidden.keyword, registeredHidden.keyword.toLowerCase());
  assert.equal(backline.keyword, registeredBackline.keyword.toLowerCase());
});

test("unl-141-219 Evelynn, Entrancing golden: accepting moves the locked enemy unit to my battlefield", () => {
  // The card's own nested target declaration sits on the Move step, so the interpreter re-selects it.
  // Locking the target through the caller (as Finalize does) and running the body without the nested
  // declaration reproduces the production call: the printed destination still comes from the card's
  // own conditional lock of "my battlefield".
  const kernel = evesBoard();
  kernel.setTargets("evelynn-entrancing.enemy-unit-elsewhere", [kernel.ref("enemy-elsewhere")]);
  kernel.setAnswers({ "evelynn-entrancing.may-move/optional": true });
  const runnable = {
    ...mayMove,
    args: {
      ...mayMove.args,
      body: {
        ...mayMove.args.body,
        value: mayMove.args.body.value.map(step => {
          if (step.id !== "evelynn-entrancing.move-enemy") return step;
          const { targets, ...rest } = step;
          return rest;
        })
      }
    }
  };

  const outcome = resolveChainBody([runnable], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["evelynn-entrancing.my-battlefield", "executed"],
    ["evelynn-entrancing.move-enemy", "executed"],
    ["evelynn-entrancing.may-move", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("enemy-elsewhere").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(kernel.getObject("evelynn").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(outcome.events.map(event => event.action), ["move-location"]);
});

test("unl-141-219 Evelynn, Entrancing golden: declining performs no move (contract 3.9)", () => {
  const kernel = evesBoard();
  kernel.setTargets("evelynn-entrancing.enemy-unit-elsewhere", [kernel.ref("enemy-elsewhere")]);
  kernel.setAnswers({ "evelynn-entrancing.may-move/optional": false });

  const { targets, ...runnable } = mayMove;
  const outcome = resolveChainBody([runnable], kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["evelynn-entrancing.may-move", "negated", "skipped"]
  ]);
  assert.deepEqual(kernel.getObject("enemy-elsewhere").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-141-219 Evelynn, Entrancing: subscribe 'When you play me from face down on your turn' (CR 811.1.d) — the " +
    "card-played payload and ObjectSnapshot expose no face-down origin fact, and no turn-ownership predicate exists"
);
test.todo(
  "unl-141-219 Evelynn, Entrancing: filter 'an enemy unit at a different location' (CR 355.4.a) — ObjectFilter has " +
    "sameLocationAs but no location-negation anchor, and merged filters ignore unknown anchors"
);
test.todo(
  "unl-141-219 Evelynn, Entrancing: [Hidden] runtime (CR 811.1.d hide, 811.6 next-turn Reaction and the 0-Energy " +
    "facedown play) — cost.hidden has no consumer and zones/actions have no Facedown Zone (cost/README.md item 3, RIFT-84)"
);
test.todo(
  "unl-141-219 Evelynn, Entrancing: [Backline] damage-assignment ordering (CR 826.3 / 826.4.b) — the continuous.combat " +
    "consumer is unmerged (RIFT-258/259 and the combat workstream)"
);
