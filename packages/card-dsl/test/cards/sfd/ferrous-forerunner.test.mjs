// Golden test for Ferrous Forerunner (sfd-021-221).
// The keyword declaration and explicit printed body bind into one self-death
// trigger. A real kill passes through ProgramBinding + ChainEngine + lifecycle,
// and effect.token creates and plays the 3 Might Mechs to the controller's Base.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/ferrous-forerunner.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3";
const BATTLEFIELD = { type: "battlefield", id: "bf-ferrous" };
const base = player => ({ type: "base", player });

function ferrousTable(controller = "A") {
  return productionPlay({
    programs: [program],
    build: w => w.player("A").player("B").unit("forerunner", {
      cardId: CANONICAL,
      name: "Ferrous Forerunner",
      types: ["unit"],
      owner: controller,
      controller,
      might: 6,
      energy: 6,
      power: ["Fury"],
      location: BATTLEFIELD
    })
  });
}

function killAndSettle(controller) {
  const f = ferrousTable(controller);
  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("forerunner") });
  assert.equal(outcome.status, "done");
  assert.equal(f.engine.items.length, 1, "one printed Deathknell text creates one Pending Item");
  assert.deepEqual(f.engine.items[0].body.map(instruction => instruction.op), ["trigger.leave", "effect.token"]);
  assert.equal(f.engine.items[0].trigger.source.ref.id, "forerunner");
  assert.equal(f.engine.items[0].trigger.source.zone, "board");
  assert.deepEqual(f.engine.items[0].trigger.source.location, BATTLEFIELD);
  f.engine.advance();
  f.settle();
  return f;
}

test("program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.match(program.sourceText, /\[Deathknell\]/);
});

test("Deathknell is modeled as a mandatory object-killed trigger on self", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, ability] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.body.length, 1);
});

test("body instruction plays two 3-might Mech tokens to the controller base", () => {
  const [, ability] = program.abilities;
  const [instruction] = ability.body;
  assert.equal(instruction.id, "ferrous-forerunner.play-tokens");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

for (const controller of ["A", "B"]) {
  test(`production golden: ${controller}'s Forerunner death plays two real Mechs to ${controller}'s Base`, () => {
    const f = killAndSettle(controller);
    const tokens = f.kernel.objects.filter(object => object.isToken);
    assert.equal(tokens.length, 2);
    for (const token of tokens) {
      assert.equal(token.name, "Mech");
      assert.equal(token.might, 3);
      assert.deepEqual(token.tags, ["Mech"]);
      assert.equal(token.controller, controller);
      assert.deepEqual(token.location, base(controller));
      assert.equal(token.exhausted, true, "CR 143.4/185.2.d: Unit tokens enter exhausted");
      assert.equal(token.energy, null, "CR 185.3.a: tokens do not have printed costs");
      assert.equal(token.power, null, "CR 185.3.a: tokens do not have printed costs");
    }
    assert.equal(f.kernel.getObject("forerunner").zone, "trash");
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed").length, 1);
    assert.equal(f.engine.trace.filter(entry => entry.step === "finalized").length > 0, true);
  });
}

test("production boundary: replacing the kill with a move to Base creates no death trigger or token", () => {
  const f = ferrousTable("A");
  const source = f.kernel.ref("forerunner");
  f.engine.pipeline.registerReplacement({
    id: "replace-kill-with-base-move",
    matches: action => action.type === "kill" && action.object.id === "forerunner",
    apply: action => ({
      status: "replace",
      actions: [{ type: "move-location", object: action.object, to: base("A") }]
    })
  });
  const outcome = f.engine.commit({ type: "kill", object: source });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("forerunner").zone, "board");
  assert.deepEqual(f.kernel.getObject("forerunner").location, base("A"));
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed").length, 0);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
});

test("production boundary: leaving the Board without a kill does not invoke Deathknell", () => {
  const f = ferrousTable("A");
  const source = f.kernel.ref("forerunner");
  const outcome = f.engine.commit({ type: "move-zone", object: source, to: "hand" });
  assert.equal(outcome.status, "done");
  assert.equal(f.kernel.getObject("forerunner").zone, "hand");
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-killed").length, 0);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
});
