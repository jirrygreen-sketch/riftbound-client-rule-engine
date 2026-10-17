
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/evelynn-in-control.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import disarm from "../../../../engine-core/dist/effects/keywords/Disarm.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-7e71cd4d3c2627a9d36c7f7721c81b82138aba4816e45b83c1e9c58026ef9c9a";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "When I hold, if you control a facedown card here, score 1 point.";

const [disarmKeyword, holdTrigger] = program.abilities;
const [scoreOne] = holdTrigger.body;
const condition = holdTrigger.trigger.condition;

test("rad-109-167 Evelynn, In Control: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-109-167 Evelynn, In Control: judgeReason names Disarm, the Facedown Zone and the hold emitter", () => {
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /attack-declared/);
  // The hold emitter is merged now, so it must not be reported as missing.
  assert.doesNotMatch(program.judgeReason, /RIFT-76/);
});

test("rad-109-167 Evelynn, In Control: [Disarm] is declared and its merged expansion is the card's carried semantics (831.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(disarmKeyword, { kind: "keyword", keyword: "disarm" });
  // The merged Disarm KeywordDef exists; the card must not hand-write the
  // attack trigger + temporary -1 Might itself (README section 5).
  assert.equal(keywordDefinitionsById.has("Disarm"), true);
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("rad-109-167 Evelynn, In Control: the merged Disarm expansion really registers a -1 Might this-turn effect", () => {
  const [expansion] = disarm.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "attack-declared");
  const [instruction] = expansion.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });

  // Drive the expansion's own body through the merged interpreter: the locked
  // enemy unit really gets the -1 Might arithmetic effect for this turn.
  const kernel = world()
    .unit("eve", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("foe", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({
    source: kernel.ref("eve"),
    sourceSnapshot: kernel.getObject("eve")
  });
  // The merged primitive receives the expansion's own amount/duration; only the
  // TargetSpec id is supplied in the decoded string form the primitive expects
  // (the chain adapter does not yet decode continuous.might's target argument,
  // see the todo at the end).
  const run = runInstruction(
    might,
    { ...instruction.args, target: "disarm.enemy-unit" },
    { world: scoped, targets: { "disarm.enemy-unit": [kernel.ref("foe")] } }
  );
  assert.equal(run.result.status, "executed");

  const [registered] = scoped.snapshot().continuous;
  assert.equal(registered.effect.layer, "arithmetic");
  assert.equal(registered.effect.effect.kind, "continuous.might");
  assert.equal(registered.effect.effect.amount, -1);
  assert.deepEqual(registered.duration, { type: "end-of-turn" });

  const engine = createLayerEngine(
    scoped.query({}),
    scoped.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(engine.evaluate(kernel.ref("foe")).might, 2);
  assert.equal(engine.evaluate(kernel.ref("eve")).might, 4);
});

test("rad-109-167 Evelynn, In Control: 'When I hold' is the self-scoped hold trigger (383.4.d.2.a)", () => {
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, {
    event: "hold",
    player: "self",
    details: { battlefieldId: "self" }
  });
  assert.equal(holdTrigger.trigger.once, undefined);
  assert.equal(holdTrigger.optional, false);
});

test("rad-109-167 Evelynn, In Control: the facedown clause is a trigger condition, not an effect clause (383.2.a.1)", () => {
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "facedown-cards-you-control-here");
  assert.deepEqual(condition.left.filter, {
    type: "card",
    controller: "self",
    zone: "facedown-zone",
    sameLocationAs: "source"
  });
  // The clause is part of the trigger condition, so it must not be duplicated as
  // an instruction-level condition.
  assert.equal(scoreOne.condition, undefined);
});

test("rad-109-167 Evelynn, In Control: the effect scores 1 point through the merged effect.score (194.1.c/470.1)", () => {
  assert.equal(holdTrigger.body.length, 1);
  assert.equal(scoreOne.id, "evelynn.score-one");
  assert.equal(scoreOne.op, "effect.score");
  assert.deepEqual(scoreOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(scoreOne.targets, undefined);
  assert.equal(scoreOne.picks, undefined);
  assert.equal(scoreOne.linkedTo, undefined);

  const kernel = world().player("A", { score: 2 }).build();
  const run = runInstruction(score, scoreOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 3);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(run.events.map(event => event.action), ["score"]);
});

test("rad-109-167 Evelynn, In Control: the declared facedown condition cannot be satisfied today", () => {
  // The contract ZoneId has no facedown-zone member (effect.stun.ts records the
  // same gap), so the declared count query resolves to nothing even with a
  // face-down card on the board: the trigger stays inert. This pins the gap.
  const kernel = world()
    .unit("eve", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.addObject(
    {
      ref: { id: "facedown", zoneEntryId: 1 },
      cardId: null,
      name: "facedown",
      types: ["card"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: null,
      might: null,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: true,
      isToken: false
    },
    "board"
  );
  assert.equal(
    kernel.query({
      type: "card",
      controller: "controller",
      zone: "facedown-zone",
      sameLocationAs: "source"
    }).length,
    0
  );
  assert.equal(kernel.test(condition), false);
});

test.todo(
  "rad-109-167 Evelynn, In Control: subscribe the hold trigger and resolve effect.score for the ability " +
    "controller — the hold timing point and CardProgram TriggerRegistration are merged, but the scoring " +
    "event's battlefieldId still has no binding to the source battlefield"
);
test.todo(
  "rad-109-167 Evelynn, In Control: 'if you control a facedown card here' needs the Facedown Zone model " +
    "(CR 107.3.a / 355.9.a.3): the contract ZoneId has no facedown-zone member and no snapshot collection " +
    "exposes the controller's facedown cards at a battlefield"
);
test.todo(
  "rad-109-167 Evelynn, In Control: [Disarm]'s attack-declared trigger has no producer — combat/flow.ts still " +
    "throws combat-start-transaction for the role designation transaction (RIFT-270 audit marks it 待后续)"
);
test.todo(
  "rad-109-167 Evelynn, In Control: chain/interpreter-adapter.ts does not list the continuous.* ops in " +
    "LITERAL_FIELDS, so a card-authored target Expr reaches the primitive undecoded and resolves to an unknown " +
    "spec id; the Disarm expansion's declared target must be decoded in the chain adapter before the merged " +
    "attack trigger can resolve"
);

