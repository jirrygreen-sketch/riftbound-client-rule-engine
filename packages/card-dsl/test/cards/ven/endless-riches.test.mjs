import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/endless-riches.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture as chainFixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-6cb9652e425a872a57f461b0814a91ddbb540c9369a2fd1e18215aabfdfef16e";
const SOURCE_TEXT =
  "When you play this, banish your hand and trash, then [Burn 7].\n" +
  "Skip your Draw Phase.\n" +
  "You may play cards from your trash.\n" +
  "If a card would go to your trash from anywhere other than your Main Deck, banish it instead.";

const [playTrigger, skipDraw, playFromTrash, trashReplacement] = program.abilities;
const [banishHand, banishTrash, burnSeven] = playTrigger.body;

/** Endless Riches on the Board with a hand, a trash and a stocked Main Deck. */
function fixture() {
  const base = world()
    .unit("endless-riches", {
      types: ["gear"],
      energy: 5,
      power: ["Fury"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .hand("hand-1", { owner: "A" })
    .hand("hand-2", { owner: "A" })
    .card("trash-1", { owner: "A", zone: "trash" })
    .deck(["top-1", "top-2", "top-3", "top-4", "top-5", "top-6", "top-7", "top-8"])
    .build();
  return base.clone({
    source: base.ref("endless-riches"),
    sourceSnapshot: base.getObject("endless-riches")
  });
}

test("ven-022-166 Endless Riches: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-022-166 Endless Riches: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /444\.1/);
  assert.match(program.judgeReason, /420\.1\.a/);
  assert.match(program.judgeReason, /ACTION_KINDS/);
  assert.match(program.judgeReason, /continuous\.play-permission/);
  assert.match(program.judgeReason, /BlockedReplacementError/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-112/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-022-166 Endless Riches: the Play Effect is a mandatory card-played trigger scoped to self", () => {
  assert.equal(program.abilities.length, 4);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  // 383.4.a.1 / 383.4.a.2: a Gear Play Effect, on the chain after the Gear
  // enters the board; 420.4.a is the same completion point.
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.condition, undefined);
});

test("ven-022-166 Endless Riches: banish hand, banish trash, then Burn 7 in that order", () => {
  assert.deepEqual(playTrigger.body.map(step => [step.id, step.op]), [
    ["endless-riches.banish-hand", "effect.banish"],
    ["endless-riches.banish-trash", "effect.banish"],
    ["endless-riches.burn-7", "effect.mill"]
  ]);

  // 428.1/428.5: "your hand and trash" are two zones, each taken whole and
  // programmatically (355.10.d), so each is a zone selection and not a target.
  assert.deepEqual(banishHand.args.objects, { kind: "constant", value: { zone: "hand" } });
  assert.deepEqual(banishTrash.args.objects, { kind: "constant", value: { zone: "trash" } });
  for (const instruction of [banishHand, banishTrash]) {
    assert.equal(instruction.args.amount, undefined);
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
  // 428.3.a: separate instances do not cross-reference, so each keeps its own key.
  assert.notEqual(banishHand.args.linkKey.value, banishTrash.args.linkKey.value);

  // 441.2.a: "[Burn 7]" burns exactly seven cards of the controller's Main Deck.
  assert.equal(burnSeven.op, "effect.mill");
  assert.deepEqual(burnSeven.args.amount, { kind: "constant", value: 7 });
  assert.equal(burnSeven.linkedTo, undefined);
});

test("ven-022-166 Endless Riches: Skip / play-from-trash / trash replacement keep their printed shapes", () => {
  // 444.1 / 444.1.a.2: skipping the Draw Phase replaces that turn procedure with
  // nothing; the empty body is exactly "replaced with nothing".
  assert.equal(skipDraw.kind, "replacement");
  assert.deepEqual(skipDraw.with, []);
  assert.deepEqual(skipDraw.replaces, {
    event: "phase-procedure",
    procedure: "draw",
    player: "self"
  });

  // 420.1.a: the default playable zones are hand and the Champion Zone; this
  // sentence adds trash as a permission, kept as a declaration (see judgeReason).
  assert.equal(playFromTrash.kind, "static");
  assert.equal(playFromTrash.effect.kind, "continuous.play-permission");
  assert.deepEqual(playFromTrash.effect.zone, { kind: "constant", value: "trash" });
  assert.deepEqual(playFromTrash.effect.player, { kind: "constant", value: "self" });

  // 369.1: "would … instead" is a replacement; "from anywhere other than your
  // Main Deck" is recorded descriptively because EventPattern has no negated
  // fromZone form (the positive key is never faked).
  assert.equal(trashReplacement.kind, "replacement");
  assert.deepEqual(trashReplacement.replaces, {
    event: "object-enters-zone",
    toZone: "trash",
    notFromZone: "deck"
  });
  assert.equal(trashReplacement.replaces.fromZone, undefined);
  assert.deepEqual(trashReplacement.with[0].args, {
    objects: { kind: "constant", value: { linked: "replacement.object" } },
    linkKey: { kind: "constant", value: "endlessRichesInstead" }
  });
  assert.deepEqual(trashReplacement.with.map(step => [step.id, step.op]), [
    ["endless-riches.banish-instead", "effect.banish"]
  ]);
});

test("ven-022-166 Endless Riches golden: the body really banishes hand+trash and burns the top seven", () => {
  const kernel = fixture();
  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["endless-riches.banish-hand", "executed"],
    ["endless-riches.banish-trash", "executed"],
    ["endless-riches.burn-7", "executed"]
  ]);

  // 428.1/428.2: both zones end up in the owner's Banishment (108.6.a).
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.equal(kernel.zone("A", "banishment").length, 3);
  assert.deepEqual(
    kernel.zone("A", "banishment").map(ref => ref.id).sort(),
    ["hand-1", "hand-2", "trash-1"]
  );
  assert.equal(outcome.linkedValues["endless-riches.banish-hand.endlessRichesHandCount"], 2);
  assert.equal(outcome.linkedValues["endless-riches.banish-trash.endlessRichesTrashCount"], 1);

  // 441.1: exactly the top seven of the Main Deck moved to the trash, top first.
  assert.equal(kernel.zone("A", "trash").length, 7);
  assert.deepEqual(
    kernel.zone("A", "trash").map(ref => ref.id),
    ["top-1", "top-2", "top-3", "top-4", "top-5", "top-6", "top-7"]
  );
  assert.equal(outcome.linkedValues["endless-riches.burn-7.burnedCount"], 7);
  assert.deepEqual(kernel.events.map(event => event.action), ["banish", "banish", "banish", "mill"]);
});

test("ven-022-166 Endless Riches golden: an oversized Burn takes what is available (CR 441.4)", () => {
  const base = world()
    .unit("endless-riches", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .deck(["only-1", "only-2"])
    .build();
  const kernel = base.clone({
    source: base.ref("endless-riches"),
    sourceSnapshot: base.getObject("endless-riches")
  });

  const outcome = resolveChainBody([burnSeven], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.zone("A", "trash").length, 2);
  assert.equal(outcome.linkedValues["endless-riches.burn-7.burnedCount"], 2);
  // 428.5/428.1: the empty hand and trash selections execute with zero actions
  // instead of inventing cards.
  assert.deepEqual(kernel.zone("A", "banishment"), []);
});

test("ven-022-166 Endless Riches golden: an emptied hand and trash banish zero cards and still burn", () => {
  const kernel = fixture();
  kernel.perform({ type: "move-zone", object: kernel.ref("hand-1"), to: "trash" });
  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  // 055 / 359.3.e.11: selecting an empty set is not a failure, so the burn
  // still happens right after it.
  assert.equal(outcome.linkedValues["endless-riches.banish-hand.endlessRichesHandCount"], 1);
  assert.equal(outcome.linkedValues["endless-riches.burn-7.burnedCount"], 7);
});

test.todo(
  "ven-022-166 Endless Riches: \"Skip your Draw Phase\" (CR 444.1) needs a CardProgram replacement to be registered as an " +
    "events/pipeline ReplacementRegistration against the turn procedure; the Draw Phase itself belongs to turn/ (CR 315.4) " +
    "and no matching phase-procedure event is emitted"
);
test.todo(
  "ven-022-166 Endless Riches: \"You may play cards from your trash\" (CR 420.1.a) needs a registerable, source-bound play " +
    "permission read by the play/Finalize path - contract 3.1/3.6 has no such shape and cost/cost-plan.ts only carries the " +
    "429.1.b-style Flow rewrite for a spell already in the trash"
);
test.todo(
  "ven-022-166 Endless Riches: \"from anywhere other than your Main Deck\" needs a negated source-zone match on the replaced " +
    "event; replacement/pattern.ts needs generic object-enters-zone/toZone/notFromZone matching, " +
    "and the replacement planner needs effect.banish support (contract change request)"
);

/**
 * 复核（2026-10-17）执行证据：三条缺口都在当前内核里真实复现，
 * 用生产绑定路径而非手工结算。
 */
function replacementHost(kernel) {
  return {
    object: (ref) => kernel.objects.find((object) => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId) ?? null,
    objects: () => kernel.objects,
    context: (source, controller) => kernel.clone({ sourceSnapshot: source, controller })
  };
}

function registerReplacement(ability, kernel, hostRef) {
  const registered = [];
  return {
    registered,
    bound: bindReplacement(
      { replaces: ability.replaces, with: ability.with, ...(ability.condition === undefined ? {} : { condition: ability.condition }) },
      hostRef,
      {
        host: replacementHost(kernel),
        pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registered.push(registration), unregisterReplacement: () => {} }
      }
    )
  };
}

test("ven-022-166 Endless Riches evidence: the phase-procedure replacement never matches a closed GameAction", () => {
  const kernel = fixture();
  const { registered } = registerReplacement(skipDraw, kernel, kernel.ref("endless-riches"));
  assert.equal(registered.length, 1);
  // 444.1.a.2/444.2：跳过一个“回合流程”不是 GameAction；照常支付/抽牌都不应被拦截。
  const draw = { type: "draw", player: "A", amount: 1 };
  const score = { type: "score", player: "A", amount: 1 };
  assert.equal(registered[0].matches(draw, draw), false);
  assert.equal(registered[0].matches(score, score), false);
});

test("ven-022-166 Endless Riches evidence: no static binder mapping exists for the trash play permission", () => {
  const f = chainFixture({ cards: [{ id: "endless-riches", types: ["gear"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("endless-riches"), to: "base" });
  const binder = createEngineStaticBinder(f.engine);
  // 420.1.a：许可必须进 static 图层并影响打出流程；当前 layerFor() 直接失败关闭。
  assert.throws(
    () => binder.bindStatic(playFromTrash, f.kernel.getObject("endless-riches")),
    /continuous\.play-permission has no layer mapping/
  );
  assert.equal(playFromTrash.effect.kind, "continuous.play-permission");
});

test("ven-022-166 Endless Riches evidence: the would-go-to-trash replacement cannot bind its banish body", () => {
  const kernel = fixture();
  // 369.1/428.1：改写动作是 effect.banish；planner 未支持，绑定期就失败关闭。
  assert.throws(
    () => registerReplacement(trashReplacement, kernel, kernel.ref("endless-riches")),
    /Unsupported replacement opcode: effect\.banish/
  );
  // 入区事件也不在 ACTION_KINDS 里，即使 body 换成受支持的操作也不会匹配。
  const entry = { type: "move-zone", object: kernel.ref("hand-1"), to: "trash" };
  const probe = registerReplacement({ replaces: trashReplacement.replaces, with: [{ id: "probe", op: "effect.ready", args: { objects: { kind: "constant", value: { kind: "source" } } } }] }, kernel, kernel.ref("endless-riches"));
  assert.equal(probe.registered[0].matches(entry, entry), false);
});
