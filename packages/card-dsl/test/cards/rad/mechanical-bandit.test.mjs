import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mechanical-bandit.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { isTimingPointId, getTimingPoint } = await import(new URL("events/timing-points.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const reveal = (await import(new URL("effects/instructions/effect.reveal.js", ENGINE))).default;
const recycle = (await import(new URL("effects/instructions/effect.recycle.js", ENGINE))).default;

const CARD_ID = "card.hash-fbba24cf4707d7016fafc967822809401157688fd7d9c1ae90a2287ae2a2ea06";
const EXPECTED_SOURCE =
  "At the start of your Beginning Phase, each player reveals the top card of their Main Deck. " +
  "If you revealed a card with the lowest Energy cost, draw it. Recycle the rest.";

test("rad-111-167 Mechanical Bandit: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
});

test("rad-111-167 Mechanical Bandit: judgeReason records ordered picks and per-player collection bindings", () => {
  assert.match(program.judgeReason, /each-player/);
  assert.match(program.judgeReason, /effect\.reveal/);
  assert.match(program.judgeReason, /arithmetic\.min/);
  assert.match(program.judgeReason, /null 不是 0/);
  assert.match(program.judgeReason, /Recycle the rest/);
  // Re-probed 2026-10-17: each-player is not a PlayerId and no player-loop op
  // is registered; the beginning-start pattern is outside EVENT_PATTERN_TYPES.
  assert.match(program.judgeReason, /choice\.each-player/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
});

test("rad-111-167 Mechanical Bandit: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-111-167 Mechanical Bandit: beginning-start is a real timing point with a merged producer (315.2.a.1)", () => {
  // The trigger's timing point is part of the closed enum, and the turn flow
  // publishes it via enter('beginning') (docs/rules/timing-point-producers.md).
  assert.equal(isTimingPointId("beginning-start"), true);
  const timing = getTimingPoint("beginning-start");
  assert.equal(timing.id, "beginning-start");

  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "controller" });
  assert.equal(ability.optional, false);
});

test("rad-111-167 Mechanical Bandit: the reveal instruction names the deck top and the 1-card count (425.1/425.3)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(program.abilities[0].body.length, 1);
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "mechanical-bandit.reveal");
  assert.equal(instruction.op, "effect.reveal");
  // 425.1 / 425.3：牌库顶必须按真实区域顺序读取，而不是集合查询；
  // player 的 "each-player" 是描述性占位（玩家扇出仍缺，见 judgeReason）。
  assert.deepEqual(instruction.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(instruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.player, { kind: "constant", value: "each-player" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-111-167 Mechanical Bandit: revealing a whole single-card deck executes and links the top card", () => {
  // 可表达的部分：区域可以被完整展示（425.3.a）时不触发有序子集缺口。
  const instruction = program.abilities[0].body[0];
  const kernel = world().deck("only-card").build();
  const run = runInstruction(
    reveal,
    {
      player: { kind: "constant", value: "A" },
      zone: instruction.args.zone,
      count: instruction.args.count
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed.map((ref) => ref.id), ["only-card"]);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal"]);
  // 425.1.a.2：Reveal 不改变区域，牌仍在牌库顶。
  assert.equal(kernel.getObject("only-card").zone, "deck");
  assert.equal(kernel.player("A").deckSize, 1);
});

test("rad-111-167 Mechanical Bandit boundary: the declared each-player reveal negates instead of fanning out", () => {
  // Re-probed 2026-10-17: "each-player" is not a PlayerId, so the primitive
  // cannot resolve a recipient and reports negated/impossible with an empty
  // reveal. The per-player fan-out is the missing dependency (CR 425.3).
  const instruction = program.abilities[0].body[0];
  const kernel = world().deck(["d1", "d2"]).build();
  const run = runInstruction(
    reveal,
    { player: instruction.args.player, zone: instruction.args.zone, count: instruction.args.count },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.revealedCount, 0);
  assert.deepEqual(run.linked.revealed, []);
  assert.deepEqual(run.events, []);
  assert.equal(kernel.player("A").deckSize, 2);
});

test("rad-111-167 Mechanical Bandit: \"Recycle the rest\" would go through effect.recycle but has no bound \"rest\" set", () => {
  // 回收原语本身已合入：显式给出对象时它真的把牌放到拥有者牌库底（417.1.a / 417.1.c）。
  const kernel = world().deck(["d1", "d2"]).build();
  const rest = kernel.zone("A", "deck").find((ref) => ref.id === "d1");
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [rest] } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("d1").zone, "deck");
  // 回收后该牌在拥有者 Main Deck 底：剩下的顶牌是 d2。
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d2", "d1"]);
});

test.todo('Mechanical Bandit: each player supplies an ordered top-of-Main-Deck pick, with short/empty decks handled (CR 425.3).');
test.todo('Mechanical Bandit: compare the revealed cards base Energy including ties and absent printed costs, draw only your matching card and recycle the actual remainder (CR 206.1/414.1/417.1).');

test("Mechanical Bandit: the translated Beginning trigger matches only its controller's phase", async () => {
  const { translateTriggerFilter } = await import(new URL("programs/filters.js", ENGINE));
  const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", ENGINE));
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, "bandit", "beginning-start");
  assert.equal(matchesTriggerEvent(filter, { timingPoint: "beginning-start", player: "A" }, "A"), true);
  assert.equal(matchesTriggerEvent(filter, { timingPoint: "beginning-start", player: "B" }, "A"), false);
});

test("rad-111-167 Mechanical Bandit: the translated beginning-start trigger registers", () => {
  // The controller-scoped Beginning Phase event is accepted by the production
  // EventPattern vocabulary and installed without widening it.
  const kernel = world().unit("bandit", { cardId: CARD_ID, types: ["unit"] }).build();
  const [registration] = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    kernel.getObject("bandit")
  );
  assert.equal(registration.spec.at, "beginning-start");
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  engine.pipeline.registerTrigger(registration);
  assert.equal(engine.pipeline.hasTriggerRegistration(registration.id), true);
});
