import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sprite-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-6f54620dc8f77d546cac09d65f9233740f7ec347a9981fbe6aae3fed0b9f3ef7";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
  "(Kill it at the start of its controller's Beginning Phase, before scoring.)";

const [hiddenKeyword, actionKeyword, play] = program.abilities;
const [playSprite] = play.body;
// The printed ready-entry stipulation is a descriptive argument: the merged
// effect.token schema has no entry-override field, so the primitive runs use
// only the arguments it actually consumes. The reference kernel resolves the
// playing player itself, so the printed controller-base placeholder is
// substituted with the concrete base (the same substitution sibling
// token-creation goldens use).
const { entersReady, ...supportedArgs } = playSprite.args;
const evaluatedArgs = {
  ...supportedArgs,
  location: { kind: "constant", value: { type: "base", player: "A" } }
};

test("ogn-094-298 Sprite Call: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-094-298 Sprite Call identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-094-298 Sprite Call judgeReason names the definition, the entry state and the dependencies", () => {
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /185\.3\.a/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /beginning-start/);
  // 复核后补充：token 定义缺失与入场状态改写的实测证据。
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /Invalid effect\.token argument/);
  assert.match(program.judgeReason, /has no layer mapping/);
});

test("ogn-094-298 Sprite Call structure: [Hidden] + [Action] keywords plus one token-play instruction", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(hiddenKeyword.value, undefined);
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(playSprite.id, "sprite-call.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 440.2.c / 185.2.a: a played token is created on the Chain and handed to
  // the play flow.
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  // 143.4 / 185.2.d: "ready" is the printed entry state, not a later effect.
  assert.deepEqual(playSprite.args.entersReady, { kind: "constant", value: true });
  assert.deepEqual(playSprite.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playSprite.args.linkKey, { kind: "constant", value: "sprite" });
  // The Sprite itself is not targeted: the card creates it, it does not
  // choose it (355.7), so no TargetSpec is declared.
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
  assert.equal(playSprite.linkedTo, undefined);
  assert.equal(playSprite.condition, undefined);
});

test("ogn-094-298 Sprite Call: merged keyword and token support is explicit", () => {
  // The merged keyword definitions and token primitive are exercised below;
  // the Sprite definition and ready-entry override stay covered by the todos.
  assert.equal(keywordDefinitionsById.has("Hidden"), true);
  assert.equal(keywordDefinitionsById.has("Action"), true);
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
});

test("ogn-094-298 Sprite Call golden: the same shape with a merged definition really creates and plays a token", () => {
  // Proves the instruction shape itself is the merged play-mode handoff
  // (440.2.c / 185.2.a): only the Sprite definition and its entry state are
  // missing, so no semantics are invented for the card.
  const kernel = world().build();
  const outcome = resolveChainBody([{
    ...playSprite,
    args: {
      ...evaluatedArgs,
      token: { kind: "constant", value: "mech" }
    }
  }], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].location, { type: "base", player: "A" });
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
});

test("ogn-094-298 Sprite Call: the merged Temporary KeywordDef supplies the 816.1.b expansion", () => {
  // The keyword definition that renders 816.1.b is merged. Its
  // expansion shape is the kill trigger; the Sprite token definition and the
  // ready entry state remain separate gaps (see the todos and judgeReason).
  assert.equal(keywordDefinitionsById.has("Temporary"), true);
  const [expansion] = keywordDefinitionsById.get("Temporary").expand({
    host: { canonicalCardId: CARD_ID }
  });
  assert.equal(expansion.trigger.at, "beginning-start");
  assert.equal(expansion.body[0].op, "effect.kill");
});

test("ogn-094-298 Sprite Call: the frozen token table has no Sprite definition (current gap)", () => {
  const receipt = runInstruction(token, {
    ...evaluatedArgs,
    token: { kind: "constant", value: "sprite" }
  }, { world: world().build() });

  assert.deepEqual(receipt.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(receipt.linked.sprite.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(receipt.linked.sprite.amount, 0);
  // 同一形状换成已合入定义就真的执行：证明缺的正是 Sprite 定义本身。
  const mech = runInstruction(token, {
    ...evaluatedArgs,
    token: { kind: "constant", value: "mech" }
  }, { world: world().build() });
  assert.equal(mech.result.status, "executed");
});

test("ogn-094-298 Sprite Call: effect.token consumes the ready-entry override", () => {
  for (const key of ["ready", "entryState"]) {
    assert.throws(
      () => runInstruction(token, {
        ...evaluatedArgs,
        [key]: { kind: "constant", value: true }
      }, { world: world().build() }),
      (error) => {
        assert.match(String(error.message), /Invalid effect\.token argument/);
        return true;
      }
    );
  }
  const kernel = world().build();
  const created = runInstruction(token, {
    ...evaluatedArgs,
    token: { kind: "constant", value: "mech" },
    entersReady: { kind: "constant", value: true }
  }, { world: kernel });
  assert.equal(created.result.status, "executed");
  const tokenObject = kernel.query({ zone: "board", type: "unit" }).find((object) => object.isToken);
  assert.equal(tokenObject.exhausted, false);
});

test("ogn-094-298 Sprite Call: Hidden's cost.hidden binding registers the hidden capability", () => {
  const forged = {
    canonicalCardId: "card.hash-sprite-call-hidden-probe",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "probe",
    abilities: [{ kind: "keyword", keyword: "hidden" }]
  };
  const state = fixture({ cards: [{ id: "probe", cardId: forged.canonicalCardId, types: ["spell"] }] });
  const errors = [];
  const binding = createProgramBinding({ cardPrograms: [forged] });
  binding.attachLifecycle(state.engine, (error) => errors.push(String(error && error.message)));
  state.engine.commit({
    type: "move-zone",
    object: state.kernel.ref("probe"),
    to: "board",
    location: { type: "base", player: "A" }
  });
  assert.deepEqual(errors, []);
  assert.equal(
    state.engine.layers.registry.list().some(entry => entry.effect.effect.capabilityKind === "hidden"),
    true
  );
});

test("ogn-094-298 Sprite Call: [Action]'s showdown permission is already consumed by the chain (806.1.b)", () => {
  // 已合入：关键词展开成 continuous.timing，chain.canAct 会读取它；
  // 非回合玩家在 Showdown 中持有 Focus 时可以行动。
  const forged = {
    canonicalCardId: "card.hash-sprite-call-action-probe",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "probe",
    abilities: [
      { kind: "keyword", keyword: "action" },
      { kind: "play", body: [{ id: "draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }] }
    ]
  };
  const state = fixture({
    cards: [{ id: "probe", cardId: forged.canonicalCardId, types: ["spell"], energy: 3 }],
    turnPlayer: "A"
  });
  const binding = createProgramBinding({ cardPrograms: [forged] });
  const draft = binding.describePlay(
    { type: "play", object: state.kernel.ref("probe"), player: "A" },
    state.kernel.getObject("probe")
  );
  assert.equal(draft.speed, "action");
});

test.todo(
  "Sprite Call: the 3 Might domainless Fae Sprite with Temporary (CR 187.2 / 185.3.a null cost) as a " +
  "resolvable token definition whose beginning-start trigger (816.1.b) is admitted by the closed " +
    "event vocabulary, plus an entry-readiness override on the creation/play action (143.4 / 185.2.d)"
);
