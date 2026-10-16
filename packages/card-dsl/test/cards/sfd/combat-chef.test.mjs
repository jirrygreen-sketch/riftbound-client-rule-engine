import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/combat-chef.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import weaponmaster from "../../../../engine-core/dist/effects/keywords/Weaponmaster.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-11a243735e7d6ec7f8c088e08005d1726940f651be3103a3e9e71b92757b3410";
const SOURCE_TEXT =
  "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)";

const [keyword] = program.abilities;
const host = { canonicalCardId: CARD_ID };
const [expansion] = weaponmaster.expand({ host });
const [choiceSequence] = expansion.body;
const attachStep = choiceSequence.args.body.value.find(step => step.op === "effect.attach");

/** A board where the controller owns one Equipment and this unit is the source. */
function boardWithEquipment() {
  const base = world()
    .unit("combat-chef", { name: "Combat Chef", might: 5 })
    .object("dorans-blade", {
      name: "Doran's Blade",
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board"
    })
    .build();
  return base.clone({ sourceSnapshot: undefined, source: base.ref("combat-chef") });
}

test("sfd-092-221 Combat Chef: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-092-221 Combat Chef: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-092-221 Combat Chef: judgeReason names the missing cost opcodes and dependency", () => {
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("sfd-092-221 Combat Chef: exactly one unvalued Weaponmaster keyword ability", () => {
  // 821.1.a/821.1.b: Weaponmaster prints on Units without a numeric value.
  assert.equal(program.abilities.length, 1);
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "weaponmaster");
  assert.equal(keyword.value, undefined);
});

test("sfd-092-221 Combat Chef: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Weaponmaster");
  assert.ok(registered, "effects/keywords/Weaponmaster.ts must be in the generated registry");
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("821.1.c"));
  assert.equal(registered.stacking, "separate");
});

test("sfd-092-221 Combat Chef golden: the merged attachment step attaches the chosen Equipment to me", () => {
  // 821.1.c: the pay step is not executable yet (see judgeReason), but the
  // merged expansion's final "attach it to this unit" step is the card's
  // supported execution path and runs through the real primitive here.
  assert.ok(attachStep, "the Weaponmaster expansion must carry an effect.attach step");
  assert.equal(attachStep.op, "effect.attach");
  const kernel = boardWithEquipment();
  const run = runInstruction(attach, attachStep.args, {
    world: kernel,
    targets: { "weaponmaster-equipment": [kernel.ref("dorans-blade")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("dorans-blade").attachedTo, kernel.ref("combat-chef"));
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
});

test("sfd-092-221 Combat Chef golden: declining to choose an Equipment leaves the board unchanged", () => {
  // 821.1.b: "you may choose" — the reference kernel represents the decline
  // with an empty finalized target group for the Equipment choice.
  const kernel = boardWithEquipment();
  kernel.setTargets("weaponmaster-equipment", []);
  const outcome = runAbilityBody(expansion.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["weaponmaster-choice"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("dorans-blade").attachedTo, null);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-092-221 Combat Chef: on play, choose one of your Equipment, pay its Equip cost " +
    "reduced by [A], then attach it to me even if it is already attached (821.1.c / " +
    "821.1.c.2 / 821.1.c.3) — blocked because cost.modify / cost.pay have no registered " +
    "InstructionDef and no producer expands a card's keyword ability into the play " +
    "pipeline (RIFT-89)"
);
