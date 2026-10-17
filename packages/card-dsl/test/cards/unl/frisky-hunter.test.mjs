import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frisky-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";

const CANONICAL_ID =
  "card.hash-3a7cc51beec4c03c4ab2831bc17b65610301b0eacb31ebfd269232c29dea5258";
const SOURCE_TEXT =
  "When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here. " +
  "(Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [ability] = program.abilities;
const [playBird] = ability.body;

test("unl-033-219 Frisky Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-033-219 Frisky Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /RIFT-62/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("unl-033-219 Frisky Hunter: card-played self trigger plays the CR 187.7 Bird token here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);

  assert.equal(playBird.id, "frisky-hunter.play-bird");
  assert.equal(playBird.op, "effect.token");
  // 187.7: the 1 [M] Bird token (domainless, Bird tag, [Deflect]).
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain first.
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  // "here" = the source's location at resolution (contract 3.6 selector).
  assert.deepEqual(playBird.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "bird" });
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
  assert.equal(playBird.linkedTo, undefined);
});

test("unl-033-219 Frisky Hunter: the trigger registers through the merged program binding", () => {
  // RIFT-257: the card-played subscription is produced from the card program;
  // the body still cannot execute as written for the missing 187.7 definition.
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "frisky-hunter", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Frisky Hunter",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: BATTLEFIELD, might: 3, energy: 4, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  const expanded = binding.inspect(source).abilities.filter((entry) => entry.kind === "triggered");
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].trigger.at, "card-played");
  assert.equal(expanded[0].optional, false);
});

test("unl-033-219 Frisky Hunter golden: the same play-mode shape really creates and plays a defined token", () => {
  // Proves the declared instruction shape is the merged 440.2.c / 185.2.a handoff
  // path; only the 187.7 Bird definition itself is missing.
  const kernel = world()
    .unit("frisky-hunter", { zone: "board", location: BATTLEFIELD, might: 3 })
    .build();
  const run = runInstruction(
    token,
    {
      ...playBird.args,
      token: { kind: "constant", value: "mech" },
      location: {
        kind: "object-property",
        object: kernel.ref("frisky-hunter"),
        property: "location"
      }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const [created] = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.equal(created.might, 3);
  assert.deepEqual(created.location, BATTLEFIELD);
  assert.equal(created.controller, "A");
  assert.equal(created.energy, null);
  assert.equal(created.power, null);
  assert.deepEqual(run.events.map((event) => `${event.action}@${event.timingPoint}`), [
    "create-token@chain-item-pending",
    "play@card-played"
  ]);
});

test.todo(
  "unl-033-219 Frisky Hunter: add the CR 187.7 1 [M] Bird unit token (domainless, Bird tag, [Deflect]) " +
    "to the effect.token definition table"
);
test.todo(
  "unl-033-219 Frisky Hunter: decode the symbolic 'here' location (contract 3.6 ObjectSelector) in " +
    "effect.token.argsSchema so the card's own IR shape executes as written (RIFT-62)"
);
test.todo(
  "unl-033-219 Frisky Hunter: the Bird's [Deflect] target tax with any-domain Power payment " +
    "(CR 809.1.c.1) — target/ implements the Deflect tax, but no caller derives it from the " +
    "target's keywords yet (RIFT-90 follow-up)"
);
