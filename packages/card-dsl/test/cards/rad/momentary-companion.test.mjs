import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/momentary-companion.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-acd7471a82a9a0d5caee4793bb24dd67313afca36a5e9b63e8e43bb188c5e0d4";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, if it's not your turn, give me [Temporary]. (Kill me at the start of my controller's Beginning Phase, before scoring.)";

test("rad-095-167 Momentary Companion: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-095-167 Momentary Companion: judgeReason names the current gaps, not the merged dependencies", () => {
  // The merged dependencies must no longer be listed as gaps.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Temporary KeywordDef/);
  // The real remaining gaps: the turn predicate, the trigger registration and Hidden wiring.
  assert.match(program.judgeReason, /it's not your turn/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(/RIFT-91/.test(program.judgeReason), false);
});

test("rad-095-167 Momentary Companion: [Hidden] keyword plus the card-played trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "hidden" });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "momentary-companion.grant-temporary"
  ]);
});

test("rad-095-167 Momentary Companion: \"if it's not your turn\" is a trigger condition, not a body instruction", () => {
  const triggered = program.abilities[1];
  assert.deepEqual(triggered.trigger.condition, {
    kind: "not",
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "current-turn-player-is-controller" }
    }
  });
  // The condition gates the whole trigger (the ability does not go on the chain
  // when it is your turn), so it must not be an instruction-level condition.
  assert.equal(triggered.body[0].condition, undefined);
});

test("rad-095-167 Momentary Companion: give me [Temporary] with a permanent grant", () => {
  const [grant] = program.abilities[1].body;
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "permanent" });
  // 816.1.a: Temporary is present on Permanents; "me" is the ability host.
  assert.deepEqual(grant.targets, [
    {
      id: "momentary-companion.self",
      filter: { type: "unit", object: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-095-167 Momentary Companion: the merged Temporary KeywordDef matches the printed rules text", () => {
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  // 816.2: multiple instances are redundant, so the keyword is single-stacking.
  assert.equal(temporary.valued, false);
  assert.equal(temporary.stacking, "single");
  assert.ok(temporary.ruleRefs.includes("816.1.b"));

  // 816.1.b / 816.1.c: one mandatory trigger at the host controller's Beginning
  // Phase start, before scoring, that kills the host.
  const expansion = temporary.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  assert.equal(ability.body[0].op, "effect.kill");
  assert.deepEqual(ability.body[0].args, { self: { kind: "constant", value: true } });
});

test("rad-095-167 Momentary Companion: the printed grant really registers an ability-layer Temporary grant", () => {
  // Real execution through the merged interpreter + reference kernel: the
  // declared body registers one continuous ability-layer spec for the host.
  const grant = program.abilities[1].body[0];
  const kernel = world().unit("companion", { might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("companion") });
  scoped.setTargets("momentary-companion.self", [kernel.ref("companion")]);

  const outcome = runAbilityBody([{ ...grant, targets: undefined }], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["momentary-companion.grant-temporary", "executed"]]
  );
  assert.equal(scoped.continuousEffects.length, 1);
  const [registered] = scoped.continuousEffects;
  // 816.3 + 478.1.a: the grant lives in the ability layer and lasts permanently.
  assert.equal(registered.effect.layer, "ability");
  assert.deepEqual(registered.duration, { type: "permanent" });
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Temporary");
  // The effect is pinned to the granted incarnation of the host.
  assert.deepEqual(registered.effect.filter, {
    objectId: "companion",
    zone: "board",
    zoneEntryId: 1
  });
});

test("rad-095-167 Momentary Companion: the Temporary kill expansion really kills the host through the interpreter", () => {
  // 816.1.b: the granted keyword's trigger body is a real effect.kill on the host.
  const temporary = keywordDefinitionsById.get("Temporary");
  const [ability] = temporary.expand({ host: { canonicalCardId: CARD_ID } });
  const kernel = world().unit("companion", { might: 4 }).unit("bystander", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("companion") });

  const outcome = runAbilityBody(ability.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.op, result.result.status]),
    [["effect.kill", "executed"]]
  );
  // 429.1: the host really dies; the other unit is untouched, and the effect
  // goes through the merged kill primitive rather than a state mutation.
  assert.equal(scoped.getObject("companion").zone, "trash");
  assert.equal(scoped.getObject("bystander").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("rad-095-167 Momentary Companion: the grant is not approximated with a buff or a state mutation", () => {
  // Data-level guard: 816.3 makes Temporary a characteristic; the program must
  // never write it as a Buff counter (702) or as a direct state marker.
  const ops = program.abilities.flatMap(ability =>
    ability.kind === "triggered" ? ability.body.map(instruction => instruction.op) : []
  );
  assert.deepEqual(ops, ["continuous.grant-keyword"]);
  assert.equal(ops.includes("effect.buff"), false);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
});

test.todo(
  "rad-095-167 Momentary Companion: the 'if it's not your turn' trigger condition needs a " +
    "current-turn-player-vs-ability-controller predicate plus a host testTrigger adapter for " +
    "condition-bearing registrations (pipeline.ts throws Trigger condition adapter required)"
);
test.todo(
  "rad-095-167 Momentary Companion: subscribe the card-played trigger to the event pipeline — no merged " +
    "path registers a CardProgram triggered ability (RIFT-257 card-program binding)"
);
test.todo(
  "rad-095-167 Momentary Companion: [Hidden] (CR 811) Hide / facedown play permissions — " +
    "keywords/Hidden.ts only declares cost.hidden, buildHiddenCostPlan has no caller, and the " +
    "contract ZoneId has no facedown zone (RIFT-89)"
);
