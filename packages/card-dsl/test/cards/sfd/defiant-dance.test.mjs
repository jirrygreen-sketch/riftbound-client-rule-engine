import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/defiant-dance.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-b159649107e1268bfb45d5d2c64def273ae76898db17907192d8e25e1d7526ef";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit +2 :rb_might: this turn and another unit -2 :rb_might: this turn.";

const [reactionKeyword, play] = program.abilities;
const [buffUnit, debuffAnotherUnit] = play.body;
const buffSpec = buffUnit.targets[0];
const debuffSpec = debuffAnotherUnit.targets[0];

test("sfd-196-221 Defiant Dance: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-196-221 Defiant Dance: judgeReason names the missing Might producer and rules", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /addContinuous/);
  // The card prints no floor, so the reason must not pretend one exists, and it
  // must not claim an approximation it does not make.
  assert.match(program.judgeReason, /没有印刷下限/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("sfd-196-221 Defiant Dance structure: [Reaction] keyword plus two independent Might targets", () => {
  assert.equal(program.abilities.length, 2);
  // 813: the keyword is a pure permission and carries no value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["defiant-dance.buff-unit", "continuous.might"],
    ["defiant-dance.debuff-another-unit", "continuous.might"]
  ]);

  // "Give a unit +2 Might this turn": one chosen Board unit (355.7/355.9.b).
  assert.deepEqual(buffUnit.args, {
    amount: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.deepEqual(buffSpec, {
    id: "defiant-dance.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and another unit -2 Might this turn": a second chosen unit that is not the
  // first one; "another" is a targeting restriction (355.9.b) expressed with the
  // merged exclude anchor over the first target. No printed floor is recorded.
  assert.deepEqual(debuffAnotherUnit.args, {
    amount: { kind: "constant", value: -2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.deepEqual(debuffSpec, {
    id: "defiant-dance.another-unit",
    filter: {
      type: "unit",
      zone: "board",
      exclude: { target: "defiant-dance.unit" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(debuffAnotherUnit.args.minimum, undefined);
  assert.equal(debuffAnotherUnit.linkedTo, undefined);
  assert.equal(debuffAnotherUnit.picks, undefined);
});

test("sfd-196-221 Defiant Dance: the declared dependencies really are unregistered", () => {
  // Guards the judgeReason against drift: the Might-modification instruction
  // has no merged implementation, while the declared [Reaction] keyword does.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
});

test("sfd-196-221 Defiant Dance: the 'another unit' filter really excludes the first target", () => {
  // The exclude anchor is one of the merged OBJECT_FILTER_ANCHORS, resolved by
  // the interpreter's own set query. Run the card's declared filter through that
  // real path with the +2 target locked: the buffed unit drops out, a different
  // unit stays, and a non-unit object never qualifies.
  const kernel = world()
    .unit("buff-target", { owner: "A", controller: "A" })
    .unit("other-unit", { owner: "B", controller: "B" })
    .unit("gear-1", { owner: "A", controller: "A", types: ["gear"] })
    .build();
  const locked = kernel.ref("buff-target");
  kernel.setTargets(buffSpec.id, [locked]);
  const candidates = resolveChainBody(
    [
      {
        id: "defiant-dance.probe",
        op: "condition.value",
        args: { value: { kind: "count", subject: "unit", filter: debuffSpec.filter } }
      }
    ],
    kernel
  );
  assert.equal(candidates.status, "executed");
  // Only "other-unit" survives the filter: the locked +2 target is excluded and
  // the gear is not a unit.
  assert.equal(candidates.linkedValues["defiant-dance.probe.value"], 1);

  // Locking nothing means the "another unit" restriction excludes nothing, so
  // both Board units qualify (the anchor is a reference set, not a name).
  kernel.setTargets(buffSpec.id, []);
  const withoutFirst = resolveChainBody(
    [
      {
        id: "defiant-dance.probe",
        op: "condition.value",
        args: { value: { kind: "count", subject: "unit", filter: debuffSpec.filter } }
      }
    ],
    kernel
  );
  assert.equal(withoutFirst.linkedValues["defiant-dance.probe.value"], 2);
});

// The Might modification is the card's whole effect and has no merged producer
// yet, so there is no executable half to claim. The structural and filter
// assertions above are the runnable evidence; the actual effect stays TODO.
test.todo(
  "sfd-196-221 Defiant Dance: give one unit +2 Might and another unit -2 Might this turn in the " +
    "arithmetic layer, expiring together at cleanup (CR 143.2.a / 317.2.c) — needs a card-facing " +
    "continuous.might / effect.might-modify instruction that registers through ResolveContext.addContinuous " +
    "plus the duration consumer (RIFT-91), with no floor beyond the general 143.2.c treatment"
);

test.todo(
  "sfd-196-221 Defiant Dance: [Reaction] admission in a Closed State on another player's turn " +
    "(CR 813.1.c) — the keyword expansion is merged, but chain.canAct does not read declared keywords " +
    "(RIFT-84/RIFT-85 chain admission)"
);
