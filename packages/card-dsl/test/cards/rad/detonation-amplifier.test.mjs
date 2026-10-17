import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/detonation-amplifier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5781b7f1661449d933821ba1a1c0653a6180580f9335eaee79a838078eb62552";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this, you may kill another friendly unit or gear to draw 1.\n" +
  "Friendly [Deathknell] effects here trigger an additional time.";

const [deploy, playTrigger, multiplicity] = program.abilities;
const [mayKill] = playTrigger.body;
const [killCost, draw] = mayKill.args.body.value;
const [sacrificeSpec] = killCost.picks;

// Finalize locks the non-target pick; the reference kernel compares filter
// values literally. The PickSpec stays in the program and is asserted
// structurally, and the golden test supplies the locked choice.
const bodyWithLockedPicks = [
  {
    ...mayKill,
    args: {
      ...mayKill.args,
      body: {
        ...mayKill.args.body,
        value: mayKill.args.body.value.map(({ picks, ...rest }) => rest)
      }
    }
  }
];

function fixture(answers) {
  const kernel = world()
    .unit("source-gear", {
      types: ["gear"],
      energy: 4,
      power: null,
      zone: "board",
      location: { type: "battlefield", id: "bf1" }
    })
    .unit("friendly-unit", { might: 2 })
    .unit("friendly-gear", { types: ["gear"], energy: 1 })
    .deck(["drawn-a", "drawn-b"])
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("source-gear") });
  scoped.setPicks("detonation-amplifier.sacrificed", [kernel.ref("friendly-gear")]);
  if (answers) scoped.setAnswers(answers);
  return scoped;
}

test("rad-017-167 Detonation Amplifier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-017-167 Detonation Amplifier: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-017-167 Detonation Amplifier: the judgeReason names the actual merged gaps", () => {
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /Deathknell/);
  assert.match(program.judgeReason, /383\.4\.g\.1/);
  // The Deploy KeywordDef and card-program adapter are merged; the gaps are
  // its location/here consumers and trigger multiplicity.
  assert.match(program.judgeReason, /RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
});

test("rad-017-167 Detonation Amplifier: [Deploy] declared, play effect at card-played, multiplicity declaration", () => {
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 383.4.a.1 / 383.4.a.2: "When you play this" is a Gear Play Effect, put on
  // the chain after the Gear is finalized and enters the board.
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.body.length, 1);

  // 383.4.g.1: the additional-trigger rewrite has no consumer; it stays a
  // documented declaration and must not be modelled as a repeat.
  assert.equal(multiplicity.kind, "static");
  assert.equal(multiplicity.effect.kind, "continuous.trigger-multiplicity");
  assert.equal(multiplicity.effect.mode, "additional");
  assert.deepEqual(multiplicity.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(multiplicity.effect.appliesTo, {
    keyword: "deathknell",
    controller: "self",
    zone: "board",
    here: true
  });
});

test("rad-017-167 Detonation Amplifier: the may wraps the chosen instructions (contract 3.9)", () => {
  assert.equal(mayKill.id, "detonation-amplifier.may-kill-opt");
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(mayKill.args.body.kind, "constant");
  assert.deepEqual(
    mayKill.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["detonation-amplifier.kill-cost", "effect.kill"],
      ["detonation-amplifier.draw-1", "effect.draw"]
    ]
  );
  // The kill is the cost within instructions of "[do X] to [do Y]"
  // (355.10.c.1), so it is a non-target pick, and the draw is linked to it so
  // a negated cost does not draw (359.3.e.14).
  assert.equal(killCost.targets, undefined);
  assert.equal(draw.linkedTo, "detonation-amplifier.kill-cost");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });

  assert.equal(sacrificeSpec.id, "detonation-amplifier.sacrificed");
  assert.deepEqual(sacrificeSpec.filter, {
    type: ["unit", "gear"],
    controller: "self",
    zone: "board",
    other: true
  });
  assert.equal(sacrificeSpec.min, 1);
  assert.equal(sacrificeSpec.max, 1);
  assert.equal(sacrificeSpec.selection, "one");
});

test("rad-017-167 Detonation Amplifier golden: accepting kills the chosen permanent and draws 1", () => {
  const kernel = fixture({ "detonation-amplifier.may-kill-opt/optional": true });

  const outcome = resolveChainBody(bodyWithLockedPicks, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results[0].result.status,
    "executed"
  );
  // 429: the chosen friendly gear was killed; 204.3.a the draw followed.
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("friendly-unit").zone, "board");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "draw"]);
});

test("rad-017-167 Detonation Amplifier golden: declining skips both the kill and the draw", () => {
  const kernel = fixture({ "detonation-amplifier.may-kill-opt/optional": false });

  const outcome = resolveChainBody(bodyWithLockedPicks, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "rad-017-167 Detonation Amplifier: Deploy's location, cleanup and Hold/here consumers remain " +
    "unavailable (RIFT-357), and 'trigger an additional time' still needs an events multiplicity hook (383.4.g.1)."
);
