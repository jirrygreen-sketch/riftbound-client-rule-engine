import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/an-offer-you-cant-refuse.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const kill = (await import(new URL("effects/instructions/effect.kill.js", ENGINE))).default;
const token = (await import(new URL("effects/instructions/effect.token.js", ENGINE))).default;

const CARD_ID = "card.hash-dec87fe514b3143f6b040acdcfc5e343b048ce4ac93600347243dd78304d770c";
const EXPECTED_SOURCE =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Kill a gear. Its controller plays a Gold gear token exhausted. " +
  "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

test("rad-101-167 An Offer You Can't Refuse: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /Its controller/);
});

test("rad-101-167 An Offer You Can't Refuse: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-101-167 An Offer You Can't Refuse: [Action] keyword plus one play ability", () => {
  assert.equal(program.abilities.length, 2);
  const [action, play] = program.abilities;
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((step) => [step.id, step.op]), [
    ["an-offer.kill-gear", "effect.kill"],
    ["an-offer.play-gold-token", "effect.token"]
  ]);
});

test("rad-101-167 An Offer You Can't Refuse: the kill instruction targets one board gear (CR 429.6)", () => {
  const [instruction] = program.abilities[1].body;
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "chosen-gear" });
  assert.equal(instruction.linkedTo, undefined);
  assert.deepEqual(instruction.targets, [{
    id: "chosen-gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("rad-101-167 An Offer You Can't Refuse: the kill instruction really kills a gear in the reference kernel", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world()
    .unit("an-offer", { types: ["gear"], might: null, energy: 2, power: null, zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-gear", { owner: "B", types: ["gear"], might: null, energy: 1, power: null, zone: "board", location: { type: "base", player: "B" } })
    .build();
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { "chosen-gear": [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["enemy-gear"]);
});

test("rad-101-167 An Offer You Can't Refuse: the token instruction creates nothing against the reference kernel", () => {
  // 两处 judge-required 的缺口都会让这条指令失败：
  // (a) 按程序原样执行时，location.player 的 \"killed-gear-controller\" 不是合法基地归属
  //     （该位置只有运行时才能由被消灭 Gear 的控制者确定），effect.token 判 negated；
  // (b) 即便把位置换成真实玩家基地，187.5 的 Gold token 不在定义表内，
  //     effect.token 以 blockedReason \"token-definition-or-abilities-judge-required\" 返回 negated。
  // 两条路径都不会创建任何 token，也没有横置入场。
  const instruction = program.abilities[1].body[1];
  let kernel = world().build();
  const asWritten = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      location: instruction.args.location,
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(asWritten.result.status, "negated");
  assert.equal(asWritten.result.reason, "impossible");
  assert.deepEqual(asWritten.events, []);
  assert.deepEqual(kernel.query({}).length, 0);

  kernel = world().build();
  const concreteBase = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(concreteBase.result.status, "negated");
  assert.equal(
    concreteBase.linked.goldToken.blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.equal(concreteBase.linked.goldToken.amount, 0);
  assert.deepEqual(concreteBase.events, []);
  assert.deepEqual(kernel.query({}).length, 0);
});

test.todo("rad-101-167 An Offer You Can't Refuse: the Gold gear token definition (CR 187.5, with its own \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\" ability) must be added to the frozen token table before it can be created.");
test.todo("rad-101-167 An Offer You Can't Refuse: \"plays a Gold gear token exhausted\" needs the create-token entry-state override (CR 143.4 / 185.2.d); a follow-up effect.exhaust is not equivalent and is deliberately not used.");
test.todo("rad-101-167 An Offer You Can't Refuse: \"Its controller\" needs the killed gear's controller bound from the kill result as the token's player (no event-object ObjectSelector and no linked-object controller expression are merged).");
