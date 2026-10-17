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

test("rad-095-167 Momentary Companion: judgeReason names turn, Hidden permissions and dynamic keyword triggers", () => {
  assert.match(program.judgeReason, /回合玩家\/控制者条件/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /连续授予关键词/);
  assert.match(program.judgeReason, /beginning-start/);
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

test("rad-095-167 Momentary Companion: the unbound turn condition stays an explicit judged dependency", () => {
  assert.match(program.judgeReason, /回合玩家\/控制者条件/);
  assert.match(program.judgeReason, /回合玩家\/控制者条件/);
  assert.equal(program.status, "judge-required");
});

test("rad-095-167 Momentary Companion: give me [Temporary] with a permanent grant", () => {
  const [grant] = program.abilities[1].body;
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Temporary" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "permanent" });
  // "me" binds the source without becoming a target (CR 355.10.c).
  assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grant.targets, undefined);
  assert.equal(grant.picks, undefined);
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
  const kernel = world().unit("companion", { might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("companion") });
  const outcome = runAbilityBody(program.abilities[1].body, scoped);
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

test.todo('Momentary Companion: compare turn player with controller when card-played triggers, before granting Temporary.');
test.todo('Momentary Companion: consume cost.hidden in actual Hide/facedown play permissions and zero base cost (CR 811).');
test.todo('Momentary Companion: after the continuous Temporary grant, install its self-kill trigger at the controller Beginning Phase before scoring (CR 816.1.b).');
