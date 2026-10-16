// Golden test for Storm Raptor (rad-036-167).
//
// judge-required (see the program's judgeReason): the death trigger's "here"
// condition cannot be matched truthfully — the trigger matcher ignores the
// sameLocationAs anchor and silently passes unknown filter keys. The runnable
// evidence is the Deflect keyword declaration (with its merged expansion), the
// readable Stunned predicate, and the Draw 1 the trigger body performs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/storm-raptor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import {
  matchesTriggerEvent,
  matchesTriggerObject
} from "../../../../engine-core/dist/events/pipeline-match.js";

const CANONICAL =
  "card.hash-f595b4941f399b2ac63a4066a8805f35b600f3bf7ad4bf6a5b2c66ac8e4d9a21";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When a stunned enemy unit dies here, draw 1.";

const [deflectKeyword, triggered] = program.abilities;
const [drawInstruction] = triggered.body;

test("rad-036-167 Storm Raptor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-036-167 Storm Raptor: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the unmatched condition, the rule and the task.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /053\.3/);
  assert.match(program.judgeReason, /静默放行/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-036-167 Storm Raptor: [Deflect] is declared and the merged KeywordDef owns its expansion", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // CR 809.1.b.3: a printed [Deflect] with no number is Deflect 1.
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  // CR 809.1.c: the tax is paid in Power of any Domain.
  assert.ok(deflect.ruleRefs.includes("809.1.c.1"));
});

test("rad-036-167 Storm Raptor: the death trigger declares the Stunned enemy unit dying at this location", () => {
  assert.equal(triggered.kind, "triggered");
  // CR 429.1: the timing point is the kill; 808.1.d.1 shows simultaneous death
  // triggers use the same object-killed timing point.
  assert.equal(triggered.trigger.at, "object-killed");
  assert.equal(triggered.trigger.filter.event, "object-killed");
  // CR 424.1.a: Stunned is a binary state on the dying unit.
  assert.equal(triggered.trigger.filter.filter.states, "stunned");
  // 053.3 restricts "here" to Battlefields; this card is a Unit, so it means
  // "the location this unit is at" (421.1), declared with the location anchor.
  assert.equal(triggered.trigger.filter.filter.sameLocationAs, "source");
  assert.equal(triggered.trigger.filter.filter.controller, "opponent");
  assert.equal(triggered.trigger.filter.filter.type, "unit");
  assert.equal(triggered.optional, false);
});

test("rad-036-167 Storm Raptor: the trigger body is a plain controller Draw 1", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(drawInstruction.id, "storm-raptor.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  // CR 414.3 / 190.6.d: the triggering ability's controller draws the card.
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-036-167 Storm Raptor: the Draw 1 really draws for the controller", () => {
  const kernel = world().unit("storm-raptor", { might: 6 }).deck(["top-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.getObject("storm-raptor").zone, "board");
});

test("rad-036-167 Storm Raptor: the Stunned condition is readable by the merged trigger matcher (424.1.a)", () => {
  const stunnedEnemy = {
    ref: { id: "enemy", zoneEntryId: 1 },
    cardId: "enemy",
    name: "enemy",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: true,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesTriggerObject({ states: "stunned" }, stunnedEnemy, "A"), true);
  assert.equal(
    matchesTriggerObject({ states: "stunned" }, { ...stunnedEnemy, stunned: false }, "A"),
    false
  );
  // The declared filter carries exactly the readable clause plus the location anchor.
  assert.equal(triggered.trigger.filter.filter.states, "stunned");
  assert.equal(triggered.trigger.filter.filter.controller, "opponent");
});

test("rad-036-167 Storm Raptor: the declared 'here' anchor is silently ignored by trigger matching", () => {
  // This is the concrete reason the card cannot be executable: the location
  // anchor is not implemented for triggers, and unknown keys pass, so the
  // declared filter matches a death anywhere on the board.
  const farEnemy = {
    ref: { id: "far-enemy", zoneEntryId: 1 },
    cardId: "far-enemy",
    name: "far-enemy",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "other-battlefield" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: true,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesTriggerObject({ sameLocationAs: "source" }, farEnemy, "A"), true);
  const killed = { timingPoint: "object-killed", object: farEnemy, player: "A" };
  // A death at a different battlefield would satisfy the declared filter today.
  assert.equal(matchesTriggerEvent(triggered.trigger.filter, killed, "A"), true);
});

test.todo(
  "Storm Raptor: 'a stunned enemy unit' completes on its own (the chain takes the pre-zone-change snapshot for object-killed and " +
    "matchesTriggerObject implements the stunned predicate) — the blocker is the 'here' half below"
);

test.todo(
  "Storm Raptor: 'dies here' — blocked because the sameLocationAs anchor is only implemented for the interpreter's set queries " +
    "(interpreter/selectors.ts), while trigger matching ignores the anchor and silently passes unknown filter keys, so wiring the " +
    "declared filter would count enemy deaths anywhere on the board (053.3 / 421.1; RIFT-120 follow-up)"
);

test.todo(
  "Storm Raptor: [Deflect] expansion — the KeywordDef is merged (RIFT-84) but no producer turns a card's keyword declaration into a " +
    "registered target tax on the host, and no card-played/object-killed trigger registration is wired from card programs (RIFT-91 / RIFT-120)"
);
