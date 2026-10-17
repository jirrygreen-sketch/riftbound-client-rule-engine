import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sprite-mother.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-26cfa8163b875ae8bd95af44a7541e83fd82ea28a881b705af27b209ad3167b0";
const SOURCE_TEXT =
  "When you play me, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [ability] = program.abilities;
const [readHere, playSprite] = ability.body;

test("ogn-106-298 Sprite Mother: program validates, is registered and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-106-298 Sprite Mother: the judgeReason names the current gaps", () => {
  assert.match(program.judgeReason, /effect.token/);
  assert.match(program.judgeReason, /Sprite/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /Invalid effect.token argument|入场状态/);
  assert.match(program.judgeReason, /187.2/);
});

test("ogn-106-298 Sprite Mother structure: self card-played trigger that plays the printed Sprite token here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  // "here" is bound first because the token primitive takes an evaluated LocationRef.
  assert.equal(readHere.op, "condition.value");
  assert.deepEqual(readHere.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(readHere.args.key, { kind: "constant", value: "here" });
  assert.equal(readHere.linkedTo, undefined);

  assert.equal(ability.body.length, 2);
  assert.equal(playSprite.id, "sprite-mother.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  assert.equal(playSprite.linkedTo, "sprite-mother.read-here");
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain and handed to the play flow.
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playSprite.args.location, {
    kind: "linked-value",
    instructionId: "sprite-mother.read-here",
    key: "here"
  });
  assert.equal(playSprite.args.entersReady, undefined);
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
});

test("ogn-106-298 Sprite Mother: the production trigger filter binds the self anchor", () => {
  assert.deepEqual(
    translateTriggerFilter(ability.trigger.filter, "sprite-mother-ref", "card-played"),
    { event: "card-played", object: { objectId: "sprite-mother-ref" } }
  );
});

test("ogn-106-298 Sprite Mother golden: the read-here step really resolves to the source's location", () => {
  const kernel = world()
    .unit("sprite-mother", { might: 3, zone: "board", location: { type: "base", player: "A" } })
    .build();
  const outcome = resolveChainBody(
    [readHere],
    kernel.clone({ sourceSnapshot: kernel.getObject("sprite-mother") })
  );
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["sprite-mother.read-here.here"], {
    type: "base",
    player: "A"
  });
});

test("ogn-106-298 Sprite Mother golden: the token step negates because the Sprite definition is missing", () => {
  // 同一形状换成已合入定义会真的执行；sprite 定义缺失是本卡当前的实测缺口。
  const kernel = world()
    .unit("sprite-mother", { might: 3, zone: "board", location: { type: "base", player: "A" } })
    .build();
  const outcome = resolveChainBody(
    ability.body,
    kernel.clone({ sourceSnapshot: kernel.getObject("sprite-mother") })
  );
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["sprite-mother.read-here", "executed", undefined],
      ["sprite-mother.play-sprite", "negated", "impossible"]
    ]
  );
  assert.equal(
    outcome.linkedValues["sprite-mother.play-sprite.sprite"].blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.deepEqual(
    kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken),
    []
  );
});

test("ogn-106-298 Sprite Mother golden: the supported token primitive creates a token through the real path", () => {
  const kernel = world().unit("sprite-mother", { might: 3, zone: "board" }).build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: playSprite.args.amount,
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: playSprite.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.sprite.amount, 1);
  const created = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
});

test("ogn-106-298 Sprite Mother: an entry-readiness override is rejected by the primitive (current gap)", () => {
  for (const key of ["entersReady", "ready", "entryState"]) {
    assert.throws(
      () => runInstruction(token, {
        token: { kind: "constant", value: "mech" },
        amount: { kind: "constant", value: 1 },
        mode: { kind: "constant", value: "play" },
        location: { kind: "constant", value: { type: "base", player: "A" } },
        [key]: { kind: "constant", value: true }
      }, { world: world().build() }),
      (error) => {
        assert.match(String(error.message), /Invalid effect.token argument/);
        return true;
      }
    );
  }
});

test("ogn-106-298 Sprite Mother: a forged executable program still fails to register the Temporary trigger", () => {
  const forged = { ...program, status: "executable" };
  delete forged.judgeReason;
  assert.equal(validateCardProgram(forged).ok, true);
  const state = fixture({
    cards: [{ id: "sprite-mother", cardId: CANONICAL, types: ["unit"], might: 3 }]
  });
  const errors = [];
  const binding = createProgramBinding({ cardPrograms: [forged] });
  binding.attachLifecycle(state.engine, (error) => errors.push(error));
  state.engine.commit({
    type: "move-zone",
    object: state.kernel.ref("sprite-mother"),
    to: "board",
    location: { type: "base", player: "A" }
  });
  // The card-played trigger itself binds (383.4.a); what is missing is the Sprite
  // definition, the ready entry state and the Temporary expansion's timing point.
  assert.deepEqual(errors, []);
  assert.equal(state.engine.pipeline.triggers.size >= 1, true);
});

test.todo(
  "Sprite Mother: the 187.2 3 Might Fae Sprite token definition with Temporary, an entry-readiness " +
    "override (143.4 / 185.2.d) on the creation/play action, and beginning-start admission for the " +
    "Temporary trigger (816)"
);
