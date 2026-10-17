import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/tornado-warrior.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import empower from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-43f2c7b5027f6a69b6596f2643e18187e455c358ab23449967a934abe533e617";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me from face down, you may empower something here. Disempower it at end of turn.";

const [hidden, playAbility] = program.abilities;
const [mayEmpower] = playAbility.body;
const [empowerInstruction, delayedInstruction] = mayEmpower.args.body.value;

const tornadoKernel = () => {
  const base = world()
    .unit("tornado", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("ally", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("far", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-2" }
    })
    .build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("tornado") });
};

const EMPOWER_ANSWER = "tornado-warrior.empower-something-here/tornado-warrior.choose-object-here";

test("ven-099-166 Tornado Warrior: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-099-166 Tornado Warrior: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /391\.2/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.doesNotMatch(program.judgeReason, /RIFT-84|RIFT-87|RIFT-89|RIFT-91/);
});

test("ven-099-166 Tornado Warrior: [Hidden] plus a card-played play effect gated on 'from face down'", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  // 383.4.a / 420.4.a："When you play me" 是时点 card-played 的 Play Effect。
  assert.equal(playAbility.kind, "triggered");
  assert.equal(playAbility.trigger.at, "card-played");
  // “from face down”：面朝下区域不在 ObjectFilter 的 zone 词汇里，合并载荷也没有该字段，
  // 因此用 details 明确声明该条件（fail-closed，见 judgeReason 第 2 点）。
  assert.deepEqual(playAbility.trigger.filter, {
    event: "card-played",
    filter: { source: "self" },
    details: { fromFaceDown: true }
  });
  // 383.3.a：效果首部的 “you may” 是触发能力的执行决定。
  assert.equal(playAbility.optional, true);
});

test("ven-099-166 Tornado Warrior: choice.optional wraps empower + the end-of-turn disempower (3.9)", () => {
  assert.equal(mayEmpower.op, "choice.optional");
  assert.equal(mayEmpower.args.body.kind, "constant");
  assert.deepEqual(
    mayEmpower.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["tornado-warrior.empower-something-here", "effect.empower"],
      ["tornado-warrior.disempower-at-end-of-turn", "trigger.delayed"]
    ]
  );
  assert.equal(mayEmpower.linkedTo, undefined);

  // 442.1：empower 的对象是“本战场上的某个东西”，按结算期选择（choose）。
  assert.deepEqual(empowerInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "tornado-warrior.choose-object-here",
      filter: { zone: "board", sameLocationAs: "self" },
      min: 1,
      max: 1
    }
  });
  assert.deepEqual(empowerInstruction.args.linkKey, {
    kind: "constant",
    value: "empoweredObject"
  });
  assert.equal(empowerInstruction.targets, undefined);

  // 391.2 / 317.1.a：「Disempower it at end of turn」是窗口为本回合的延迟触发；
  // “it” 读上一条 empower 写入的链接值。
  assert.equal(delayedInstruction.linkedTo, "tornado-warrior.empower-something-here");
  assert.deepEqual(delayedInstruction.args.at, { kind: "constant", value: "turn-end" });
  assert.deepEqual(delayedInstruction.args.window, {
    kind: "constant",
    value: "this-turn"
  });
  const [disempowerInstruction] = delayedInstruction.args.body.value;
  assert.equal(disempowerInstruction.op, "effect.empower");
  assert.deepEqual(disempowerInstruction.args.mode, {
    kind: "constant",
    value: "disempower"
  });
  assert.deepEqual(disempowerInstruction.args.objects, {
    kind: "linked",
    instructionId: "tornado-warrior.empower-something-here",
    key: "empoweredObject.objects"
  });
});

test("ven-099-166 golden: declining the may does nothing at all", () => {
  const kernel = tornadoKernel();
  kernel.setAnswers({ "tornado-warrior.may-empower/optional": false });
  const outcome = runAbilityBody(playAbility.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["tornado-warrior.may-empower", "negated", "skipped"]]
  );
  assert.equal(kernel.getObject("ally").empowered, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-099-166 golden: the accepted empower really empowers an object on this battlefield", () => {
  const kernel = tornadoKernel();
  kernel.setAnswers({ [EMPOWER_ANSWER]: [kernel.ref("ally")] });
  const outcome = resolveChainBody([empowerInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").empowered, 1);
  // 442.1 的动作可引用（827.2.a / 442.2.a）。
  assert.deepEqual(kernel.events.map(event => event.action), ["empower"]);
  assert.deepEqual(outcome.linkedValues["tornado-warrior.empower-something-here.empoweredObject"], {
    mode: "empower",
    count: 1,
    objects: [kernel.ref("ally")]
  });
});

test("ven-099-166 golden: the chooser only offers objects on the host's battlefield", () => {
  const kernel = tornadoKernel();
  assert.throws(
    () => resolveChainBody([empowerInstruction], kernel),
    error => {
      assert.equal(error.name, "AwaitChoice");
      assert.equal(error.request.id, EMPOWER_ANSWER);
      // 「something here」＝ 与宿主同一地点；另一个战场的 far 单位不在选项里。
      assert.deepEqual(
        error.request.options.map(ref => ref.id).sort(),
        ["ally", "tornado"]
      );
      return true;
    }
  );
});

test("ven-099-166 golden: Disempower itself is a safe no-op when the chosen object is not Empowered", () => {
  const kernel = tornadoKernel();
  const run = runInstruction(
    empower,
    {
      mode: { kind: "constant", value: "disempower" },
      objects: { kind: "constant", value: { kind: "target", id: "target" } }
    },
    { world: kernel, targets: { target: [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").empowered, 0);
  assert.deepEqual(run.events.map(event => event.action), ["disempower"]);
  assert.deepEqual(run.linked.disempowered, {
    mode: "disempower",
    count: 1,
    objects: [kernel.ref("ally")]
  });
});

test.todo(
  "ven-099-166 Tornado Warrior: [Hidden]'s cost.hidden / facedown play permission has no consumer even though " +
    "the KeywordDef is merged (811.1.d); the Hide and facedown play consumer chain is still incomplete"
);

test.todo(
  "ven-099-166 Tornado Warrior: decide 'play me from face down' (355.9.a.3 / 107.3.e) — the Facedown Zone is " +
    "absent from the current object-filter vocabulary and the card-played payload carries no source zone"
);

test.todo(
  "ven-099-166 Tornado Warrior: register 'Disempower it at end of turn' as a Delayed Ability (391.2, window " +
    "this turn, 317.1.a) — connect the card-facing trigger.delayed shape to ResolveContext.registerDelayedTrigger " +
    "so the optional body registers the delayed disempower"
);
