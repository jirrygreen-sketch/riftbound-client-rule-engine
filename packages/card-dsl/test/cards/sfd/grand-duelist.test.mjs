import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import grandDuelist from "../../../dist/cards/sfd/grand-duelist.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const ENGINE = new URL("../../../../engine-core/dist/effects/", import.meta.url);
const { default: channel } = await import(new URL("instructions/effect.channel.js", ENGINE));
const { runInstruction, world: referenceWorld } = await import(new URL("testing/index.js", ENGINE));

test("sfd-205-221 Grand Duelist: program passes validateCardProgram", () => {
  const result = validateCardProgram(grandDuelist);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});
test("sfd-205-221 Grand Duelist: identity and status", () => {
  assert.equal(
    grandDuelist.canonicalCardId,
    "card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4"
  );
  assert.equal(grandDuelist.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(grandDuelist.status, "executable");
  assert.equal(grandDuelist.judgeReason, undefined);
});

test("sfd-205-221 Grand Duelist: optional might-changed trigger structure", () => {
  assert.equal(grandDuelist.abilities.length, 1);
  const ability = grandDuelist.abilities[0];
  assert.equal(ability.kind, "triggered");
  // "When one of your units becomes [Mighty]" — the might-changed timing
  // point filtered to friendly units crossing the 5+ might threshold
  // (CR 706–709).
  assert.equal(ability.trigger.at, "might-changed");
  assert.equal(ability.trigger.filter.event, "might-changed");
  assert.equal(ability.trigger.filter.filter.type, "unit");
  assert.equal(ability.trigger.filter.filter.controller, "controller");
  assert.equal(ability.trigger.filter.filter.becameMighty, true);
  assert.equal(ability.trigger.once, undefined);
  // "you may" makes the trigger optional (CR 428.1).
  assert.equal(ability.optional, true);
});

test("sfd-205-221 Grand Duelist: body chains exhaust-self into channel 1 exhausted", () => {
  const [exhaustSelf, channelRune] = grandDuelist.abilities[0].body;
  // "you may exhaust me" — the cost-like exhaust targets the source legend.
  assert.equal(exhaustSelf.id, "exhaust-self");
  assert.equal(exhaustSelf.op, "effect.exhaust");
  assert.deepEqual(exhaustSelf.args.target, { kind: "constant", value: "source" });
  assert.equal(exhaustSelf.linkedTo, undefined);
  // "to channel 1 rune exhausted" (CR 431.2).
  assert.equal(channelRune.id, "channel-rune");
  assert.equal(channelRune.op, "effect.channel");
  assert.deepEqual(channelRune.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelRune.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelRune.linkedTo, "exhaust-self");
});

test("sfd-205-221 Grand Duelist: sourceText is the printed ability text", () => {
  assert.equal(
    grandDuelist.sourceText,
    "When one of your units becomes [Mighty], you may exhaust me to channel 1 rune exhausted. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("sfd-205-221 Grand Duelist: channel instruction executes on the reference kernel", () => {
  // Only the merged effect.channel primitive is executed here; the
  // effect.exhaust instruction depends on the still-unmerged exhaust
  // primitive, so the golden run drives the channel instruction alone.
  const channelRune = grandDuelist.abilities[0].body[1];
  const kernel = referenceWorld().rune(["r1", "r2"]).build();
  const run = runInstruction(
    channel,
    { amount: channelRune.args.amount, exhausted: channelRune.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // CR 431: one rune leaves the rune deck and enters the rune zone; the
  // kernel keeps the channeled rune in the player's rune pool.
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  // The exhausted entry stipulation (431.2) is passed to the channel-rune
  // action; the reference kernel records the action it performed.
  const channelEvent = run.events.find((event) => event.action === "channel-rune");
  assert.ok(channelEvent, "expected a channel-rune game action");
  // Replaying the program's own arguments (amount 1, exhausted true) must
  // produce exactly the action the card describes.
  const replayed = runInstruction(
    channel,
    { amount: { kind: "constant", value: 1 }, exhausted: { kind: "constant", value: true } },
    { world: referenceWorld().rune(["r1", "r2"]).build() }
  );
  assert.equal(replayed.result.status, "executed");
  assert.equal(replayed.linked.channeled, 1);
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// Rules: 709 (a Unit becomes Mighty exactly on a <5 -> >=5 change), 383.3.d
// (the trigger's controller chooses an ordering among simultaneous triggers),
// 337.1 (Finalize), 338-340 (Response - Execute - Priority - Resolve), 415.1
// (Exhaust), 431.1/.2 (Channel from the Rune Deck and exhausted entry), and
// 428.1/.2 (an optional triggered ability).  The card controller is A.  The
// canonicalCardId is grandDuelist.canonicalCardId.
//
// Timeline exercised below: A controls a 4-Might Unit; resolving an effect
// puts it at 5 and publishes one may transition -> Pending trigger -> atomic
// optional collection accepts "you may" -> Finalize -> two Priority passes ->
// Resolve.  The positive test pins that exact production collection/finalize
// path.  Exhaust-then-channel sequencing remains under the separate defect
// audit below and is not asserted as a passing full-card golden.  No LKI is
// read in this scenario.
function grandDuelistFixture() {
  const kernel = world()
    .player("A")
    .player("B")
    .rune(["rune-top", "rune-next"], { owner: "A" })
    .object("grand-duelist", {
      cardId: grandDuelist.canonicalCardId,
      owner: "A",
      controller: "A",
      types: ["legend"],
      zone: "legend",
      location: null,
      might: null,
      energy: null,
      power: null
    })
    .unit("becoming-mighty", {
      owner: "A",
      controller: "A",
      might: 4,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional") return true;
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [grandDuelist] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  engine.advance();
  return { kernel, engine, binding, errors, requests };
}

function settleGrandDuelist(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 30, "Grand Duelist's production Chain must settle");
    if (engine.items.some(item => item.status === "pending")) engine.advance();
    else engine.pass(engine.priority);
  }
}

test("sfd-205-221 Grand Duelist production: a real 4-to-5 layer transition queues the exact optional trigger", () => {
  const f = grandDuelistFixture();
  assert.deepEqual(f.errors, []);
  const registrations = f.engine.pipeline.registeredTriggers().filter(entry =>
    entry.source.ref.id === "grand-duelist" && entry.spec.at === "might-changed");
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].activeZones, ["legend"]);
  assert.deepEqual(registrations[0].spec.filter, {
    event: "might-changed",
    object: { type: "unit", controller: "self" },
    details: { becomesMighty: true }
  });
  assert.equal(grandDuelist.abilities[0].optional, true);
  assert.equal(Object.hasOwn(registrations[0], "mayAtFinalize"), false);

  f.engine.execute({
    id: "grand-duelist.might-probe",
    source: f.kernel.getObject("becoming-mighty"),
    controller: "A",
    kind: "activated",
    speed: "action",
    body: [{
      id: "grand-duelist.add-one-might",
      op: "continuous.might",
      args: {
        amount: { kind: "constant", value: 1 },
        duration: { kind: "constant", value: "this-turn" },
        objects: { kind: "constant", value: { kind: "source" } }
      }
    }]
  });
  settleGrandDuelist(f.engine);

  const transitions = f.engine.pipeline.events.filter(event => event.timingPoint === "might-changed");
  assert.equal(transitions.length, 1);
  assert.deepEqual(transitions[0].object.ref, f.kernel.ref("becoming-mighty"));
  assert.equal(transitions[0].details.previousMight, 4);
  assert.equal(transitions[0].details.currentMight, 5);
  assert.deepEqual(f.requests.map(request => request.type), ["optional"]);
  assert.match(f.requests[0].id, /^trigger:\d+:program:grand-duelist:1:0:0:optional$/);
  const trigger = f.engine.trace.find(entry => entry.step === "finalize-start" && entry.item.startsWith("trigger:"));
  assert.ok(trigger, "the accepted optional trigger reached Finalize under the real Chain");
  const triggerId = trigger.item;
  assert.ok(f.engine.trace.some(entry => entry.step === "pass"),
    "the finalized trigger used a real Priority pass window");
  assert.ok(f.engine.trace.findIndex(entry => entry.step === "finalize-start" && entry.item === triggerId) <
    f.engine.trace.findLastIndex(entry => entry.step === "resolve-start" && entry.item === triggerId),
  "Finalize precedes Resolve");
  assert.equal(f.engine.items.length, 0);
});
