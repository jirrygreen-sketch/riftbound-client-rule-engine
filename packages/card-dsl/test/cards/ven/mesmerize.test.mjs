import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mesmerize.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-754aa7addecbea1ffa38ad32f6fbc52273f58dffb461b7a3b18b936fa4eee165";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose one —\n" +
  "Return a friendly unit to its owner's hand.Give an enemy unit -2 :rb_might: this turn.";

const [reaction, play] = program.abilities;
const [chooseOne] = play.body;
const [returnMode, debuffMode] = chooseOne.args.modes.value;
const [returnUnit] = returnMode.body;
const [debuffUnit] = debuffMode.body;

const MODE_SLOT = "mesmerize.choose-one/mode%3A0";
const FRIENDLY = "mesmerize.friendly-unit";
const ENEMY = "mesmerize.enemy-unit";

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" / "opponent" controller selectors of 190.6.d are bound to the acting
 * player for the execution check (the same convention as ven-162-166 Protective
 * Sands and ogn/master-yi-meditative). Only that substitution is made here;
 * instruction order, args and target specs stay the program's own.
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** The card's own body with only the Finalize-locked targets supplied by the kernel. */
const runBody = (kernel, answers) => {
  kernel.setAnswers(answers ?? {});
  return resolveChainBody(substituteController(play.body, "A"), kernel);
};

test("ven-052-166 Mesmerize: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-052-166 Mesmerize: judgeReason names the temporary-Might gap and the Finalize mode adapter", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /355\.3/);
  assert.match(program.judgeReason, /RIFT-90/);
  // The catalog's missing separator between the two modes is reported, not fixed.
  assert.match(program.judgeReason, /数据问题/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-052-166 Mesmerize: printed 1 Energy + 1 Mind Power, [Reaction] and one mode node", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });

  // 355.3 / contract 3.9: "Choose one —" is one choice.mode with count 1 and
  // distinct selection; the chosen body runs in place (never choice + linkedTo).
  assert.deepEqual(play.body.map(instruction => instruction.id), ["mesmerize.choose-one"]);
  assert.equal(chooseOne.op, "choice.mode");
  assert.deepEqual(chooseOne.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseOne.args.different, { kind: "constant", value: true });
  assert.equal(chooseOne.args.modes.kind, "constant");
  assert.deepEqual(chooseOne.args.modes.value.map(mode => mode.id), [
    "mesmerize.return-mode",
    "mesmerize.debuff-mode"
  ]);
  assert.equal(chooseOne.targets, undefined);
  assert.equal(chooseOne.picks, undefined);
  assert.equal(chooseOne.linkedTo, undefined);
});

test("ven-052-166 Mesmerize: mode 1 returns one friendly unit to its owner's hand (355.7 / 416)", () => {
  assert.equal(returnMode.body.length, 1);
  assert.equal(returnUnit.id, "mesmerize.return-unit");
  assert.equal(returnUnit.op, "effect.zone");
  assert.deepEqual(returnUnit.args.target, { kind: "constant", value: FRIENDLY });
  // 416: returning a unit to hand is its own action, submitted as the "hand"
  // destination; the owner routing lives in the action layer (108.6).
  assert.deepEqual(returnUnit.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnUnit.targets, [
    {
      id: FRIENDLY,
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(returnUnit.linkedTo, undefined);
});

test("ven-052-166 Mesmerize: mode 2 is one -2 Might this turn modification of an enemy unit", () => {
  assert.equal(debuffMode.body.length, 1);
  assert.equal(debuffUnit.id, "mesmerize.give-minus-2-might");
  // A temporary Might change is a layers arithmetic effect (continuous.might),
  // never a Buff counter (702 / 703; effect.buff's own header).
  assert.equal(debuffUnit.op, "continuous.might");
  assert.deepEqual(debuffUnit.args.amount, { kind: "constant", value: -2 });
  // 317.2.c: "this turn" expires as one batch in that turn's cleanup; the
  // sibling merged temporary-Might programs spell the same duration
  // "this-turn" (defiant-dance / hold-em).
  assert.deepEqual(debuffUnit.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(debuffUnit.targets, [
    {
      id: ENEMY,
      filter: { type: "unit", zone: "board", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // The printing has no "to a minimum of" clause, so no minimum is invented:
  // 143.2.c (below 0 counts as 0 when referenced) is a general rule.
  assert.equal(Object.hasOwn(debuffUnit.args, "minimum"), false);
});

test("ven-052-166 Mesmerize golden: the return mode really moves the unit to its owner's hand", () => {
  const kernel = world()
    .unit("friend", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(FRIENDLY, [kernel.ref("friend")]);

  const outcome = runBody(kernel, { [MODE_SLOT]: "mesmerize.return-mode" });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["mesmerize.return-unit", "executed"],
      ["mesmerize.choose-one", "executed"]
    ]
  );
  assert.equal(kernel.getObject("friend").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["friend"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand"]);
  assert.deepEqual(outcome.linkedValues["mesmerize.choose-one.value"], ["mesmerize.return-mode"]);
});

test("ven-052-166 Mesmerize golden: the return really goes to the owner's hand, not the controller's", () => {
  // The unit is owned by B but controlled by A: 416 / 108.6 route it to B's hand.
  const kernel = world().unit("borrowed", { owner: "B", controller: "A" }).build();
  kernel.setTargets(FRIENDLY, [kernel.ref("borrowed")]);

  const outcome = runBody(kernel, { [MODE_SLOT]: "mesmerize.return-mode" });

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ven-052-166 Mesmerize golden: a friendly unit that left the Board ignores the return (359.3.e.7)", () => {
  const kernel = world().unit("friend", { owner: "A" }).build();
  const stale = kernel.ref("friend");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(FRIENDLY, [stale]);

  const outcome = runBody(kernel, { [MODE_SLOT]: "mesmerize.return-mode" });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [
      ["mesmerize.return-unit", "ignored", "mistargeted"],
      ["mesmerize.choose-one", "ignored", "mistargeted"]
    ]
  );
  assert.equal(kernel.getObject("friend").zone, "trash");
  assert.equal(kernel.player("A").handSize, 0);
});

test("ven-052-166 Mesmerize golden: the merged effect.zone primitive accepts the declared hand destination", () => {
  const kernel = world().unit("friend", { owner: "A" }).build();
  // effect.zone's own argsSchema takes the TargetSpec id as a literal string
  // (the chain adapter's LITERAL_FIELDS decodes the card's constant wrapper),
  // so the direct primitive call substitutes that one evaluated value.
  const run = runInstruction(zone, { ...returnUnit.args, target: returnUnit.args.target.value }, {
    world: kernel,
    targets: { [FRIENDLY]: [kernel.ref("friend")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friend").zone, "hand");
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test.todo(
  "ven-052-166 Mesmerize: 'Give an enemy unit -2 :rb_might: this turn' needs the continuous.might layers " +
    "consumer with an end-of-turn duration (317.2.c) — RIFT-91"
);

test.todo(
  "ven-052-166 Mesmerize: the real chain executes 'Choose one —' at Finalize (CR 355.3) — " +
    "chain/engine.ts assertFinalizationSurface throws ChainContractBlockedError for choice.mode until " +
    "the Finalize/Resolve choice-plan adapter lands (RIFT-90)"
);
