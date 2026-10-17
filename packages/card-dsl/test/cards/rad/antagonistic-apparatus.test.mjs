import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/antagonistic-apparatus.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";

const ENTER_READY = "antagonistic-apparatus.enter-ready";
const PLAY_MECH = "antagonistic-apparatus.play-mech";
const BATTLEFIELD = { type: "battlefield", id: "bf-9" };

test("rad-009-167 Antagonistic Apparatus: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-a9bb0cc78cd6afeac937db36c78625e7d815c1cd4442e8115cc6f1243277c6d0"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
  );
  assert.match(program.judgeReason, /entry override|Entry overrides/i);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-009-167: enter-ready replacement plus card-played Mech token body", () => {
  assert.equal(program.abilities.length, 2);
  const [replacement, triggered] = program.abilities;
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].id, ENTER_READY);
  assert.equal(replacement.with[0].op, "effect.ready");
  // 369.3 / 805.6 的 canonical 形状：body 用符号选择器 { kind: "source" }，
  // 由 replacement planner 绑定被替代事件的对象。
  assert.deepEqual(replacement.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 2);
  const [readHere, instruction] = triggered.body;
  assert.equal(readHere.id, "antagonistic-apparatus.read-here");
  assert.equal(readHere.op, "condition.value");
  assert.deepEqual(readHere.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(readHere.args.key, { kind: "constant", value: "here" });
  assert.equal(instruction.id, PLAY_MECH);
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.linkedTo, "antagonistic-apparatus.read-here");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 新 token 经链上生成后打出（440.2.c / 185.2.a）。
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // “here” 读来源当前位置（420.3.b.2 结算时求值），经条件指令的链接值交给 token。
  assert.deepEqual(instruction.args.location, {
    kind: "linked-value",
    instructionId: "antagonistic-apparatus.read-here",
    key: "here"
  });
});

test("rad-009-167: enter-ready replacement body readies the exhausted source through the merged primitive", () => {
  const kernel = world().unit("apparatus", { might: 3, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("apparatus") });
  const run = runInstruction(ready, program.abilities[0].with[0].args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("apparatus").exhausted, true);
  assert.equal(scoped.getObject("apparatus").exhausted, false);
});

test("rad-009-167 golden: bindReplacement replaces the exhausted entry with a ready entry (CR 369.3 / 805.6)", () => {
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .base("source", { energy: 0, power: [], might: 2 })
    .hand("apparatus", { energy: 2, power: [], might: 3, types: ["unit"] })
    .build();
  const decide = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "optional") return false;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false,
    describePlay: (action, source) => ({ id: `play:${source.ref.id}`, controller: action.player, source, kind: "unit", speed: "normal", body: [] })
  });

  const [replacement] = program.abilities;
  bindReplacement(replacement, kernel.ref("apparatus"), {
    host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: (source, controller) => kernel },
    pipeline: engine.pipeline
  });
  engine.execute({ id: "play:apparatus", controller: "A", source: kernel.getObject("apparatus"), kind: "unit", speed: "normal", body: [] });
  let guard = 0;
  while (engine.items.length && guard++ < 20) engine.pass(engine.priority);

  assert.equal(kernel.getObject("apparatus").zone, "board");
  assert.equal(kernel.getObject("apparatus").exhausted, false);
  assert.equal(engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("rad-009-167: the Mech definition lands at the source location (CR 187.4)", () => {
  // 整条 body（含 “here” 的 condition.value 链接）在参照内核真实执行；token 定义表里的
  // Mech（187.4）落点取来源位置，入场就绪改写属 judgeReason/TODO。
  const kernel = world().unit("apparatus", { might: 3, location: BATTLEFIELD }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("apparatus") });
  const [readHere, playMech] = program.abilities[1].body;
  const createOnly = {
    ...playMech,
    args: { ...playMech.args, mode: { kind: "constant", value: "create" } }
  };
  const outcome = resolveChainBody([readHere, createOnly], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["antagonistic-apparatus.read-here", "executed"],
    [PLAY_MECH, "executed"]
  ]);
  const tokens = scoped.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Mech");
  assert.equal(tokens[0].might, 3);
  assert.deepEqual(tokens[0].tags, ["Mech"]);
  assert.deepEqual(tokens[0].location, BATTLEFIELD);
  assert.equal(tokens[0].controller, "A");
});

test.todo(
  "rad-009-167 Antagonistic Apparatus: the card-program adapter must wire the replacement ability " +
    "into the match lifecycle at play time (RIFT-257); the merged bindReplacement path is executed in the golden above"
);
test.todo(
  "rad-009-167 Antagonistic Apparatus: “play a ready … token here” 的“入场就绪”改写无表达位置" +
    "（effect.token 不支持 entry override，143.4.a / 184.1；不能用 effect.ready 事后补一次就绪）"
);
test.todo(
  "rad-009-167 Antagonistic Apparatus: mode \"play\" 的链上生成 + 打出流程（440.2.c / 185.2.a / " +
    "350.2 / 354）在生产链上依赖 CardProgram 绑定（RIFT-257）"
);
