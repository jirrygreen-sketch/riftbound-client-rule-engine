import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sentinel-adept.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import weaponmaster from "../../../../engine-core/dist/effects/keywords/Weaponmaster.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-b5a71d562e350fc2da5172cbd7a0ef37531661ac9a27651a3cdfc1784f22b918";
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
    .unit("sentinel-adept", { name: "Sentinel Adept", might: 3 })
    .object("long-sword", {
      name: "Long Sword",
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board"
    })
    .build();
  return base.clone({ sourceSnapshot: undefined, source: base.ref("sentinel-adept") });
}

test("sfd-008-221 Sentinel Adept: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-008-221 Sentinel Adept: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-008-221 Sentinel Adept: judgeReason names the missing cost opcodes and dependency", () => {
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /821\.1\.c\.3/);
  assert.match(program.judgeReason, /RIFT-261/);
  // The card-played source-identity payload is the second merged-but-incomplete
  // path: the expansion filters on event.source, which the production event
  // does not carry yet.
  assert.match(program.judgeReason, /event\.source/);
  assert.match(program.judgeReason, /pipeline-match/);
});

test("sfd-008-221 Sentinel Adept: exactly one unvalued Weaponmaster keyword ability", () => {
  // 821.1.a/821.1.b: Weaponmaster prints on Units without a numeric value.
  assert.equal(program.abilities.length, 1);
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "weaponmaster");
  assert.equal(keyword.value, undefined);
});

test("sfd-008-221 Sentinel Adept: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Weaponmaster");
  assert.ok(registered, "effects/keywords/Weaponmaster.ts must be in the generated registry");
  // Card IR uses the lowercase keyword id required by validateCardProgram's
  // SYMBOL_PATTERN; the KeywordDef is indexed by the printed name (821.1).
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("821.1.c"));
  assert.equal(registered.stacking, "separate");
});

test("sfd-008-221 Sentinel Adept golden: the merged attachment step attaches the chosen Equipment to me", () => {
  // 821.1.c: the pay step is not executable yet (see judgeReason), but the
  // merged expansion's final "attach it to this unit" step is the card's
  // supported execution path and runs through the real primitive here.
  assert.ok(attachStep, "the Weaponmaster expansion must carry an effect.attach step");
  assert.equal(attachStep.op, "effect.attach");
  const kernel = boardWithEquipment();
  const run = runInstruction(attach, attachStep.args, {
    world: kernel,
    targets: { "weaponmaster-equipment": [kernel.ref("long-sword")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("long-sword").attachedTo, kernel.ref("sentinel-adept"));
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
});

test("sfd-008-221 Sentinel Adept golden: declining to choose an Equipment leaves the board unchanged", () => {
  // 821.1.b: "you may choose" — the reference kernel represents the decline
  // with an empty finalized target group for the Equipment choice.
  const kernel = boardWithEquipment();
  kernel.setTargets("weaponmaster-equipment", []);
  const outcome = runAbilityBody(expansion.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["weaponmaster-choice"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("long-sword").attachedTo, null);
  assert.deepEqual(kernel.events, []);
});

test("sfd-008-221 Sentinel Adept: the source-identity filter needs a payload the production card-played event does not carry yet", () => {
  // The expansion filters on event.source (this card's identity). The
  // production card-played event from chain/engine.ts carries object/player
  // only, and events/pipeline-match.ts only matches a source filter when
  // event.source exists. This locks both durable halves: the card must keep the
  // host-bound source filter rather than rewrite the trigger onto an unrelated
  // event, and the matcher must keep the source discriminator strict.
  const [triggered] = weaponmaster.expand({ host });
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    source: { canonicalCardId: CARD_ID }
  });

  const productionEvent = {
    timingPoint: "card-played",
    kind: "card-played",
    object: {
      ref: { id: "sentinel-adept", zoneEntryId: 1 },
      cardId: CARD_ID,
      name: "Sentinel Adept",
      types: ["unit"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 3,
      energy: null,
      power: null,
      exhausted: true,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    },
    player: "A"
  };

  // The source discriminator must stay strict: it matches only when the event
  // reports this card itself as the source (the payload the production
  // card-played event still lacks), never an unrelated card.
  assert.equal(
    matchesTriggerEvent(triggered.trigger.filter, { ...productionEvent, source: productionEvent.object }, "A"),
    true
  );
  assert.equal(
    matchesTriggerEvent(
      triggered.trigger.filter,
      {
        ...productionEvent,
        source: {
          ...productionEvent.object,
          cardId: "card.hash-0000000000000000000000000000000000000000000000000000000000000000"
        }
      },
      "A"
    ),
    false
  );
  // Without a source payload the strict filter cannot match; this records the
  // current production event shape rather than claiming the card runs.
  assert.equal(matchesTriggerEvent(triggered.trigger.filter, productionEvent, "A"), false);
});

test.todo(
  "sfd-008-221 Sentinel Adept: on play, choose one of your Equipment, pay its Equip cost " +
    "reduced by [A], then attach it to me even if it is already attached (821.1.c / " +
    "821.1.c.2 / 821.1.c.3) — blocked because cost.modify / cost.pay have no registered " +
    "InstructionDef and no Finalize cost-plan consumer binds the printed Equip cost " +
    "(in-progress RIFT-261); the merged RIFT-257 adapter already registers the trigger"
);
