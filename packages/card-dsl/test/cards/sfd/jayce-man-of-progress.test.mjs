import assert from "node:assert/strict";
import test from "node:test";

import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jayce-man-of-progress.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0b7c7cbc35b5094b62d279e16731c4fea82f84054ddee4bfee7ba32cf3791d92";
const MAY_KILL_ID = "jayce.may-kill-friendly-gear";
const KILL_ID = "jayce.kill-friendly-gear";
const MAY_PLAY_ID = "jayce.may-play-gear-from-hand";
const PLAY_ID = "jayce.play-gear";
const TARGET_ID = "jayce.friendly-gear";

const [ability] = program.abilities;
const [mayKill] = ability.body;
const [killInstruction, mayPlay] = mayKill.args.body.value;
const [playInstruction] = mayPlay.args.body.value;

const resultFor = (outcome, id) => outcome.results.find((result) => result.id === id);

// "a friendly gear" resolves through the controller placeholder: the chain's
// Finalize/query wrapper normalizes `controller`/`owner` "self" to the item's
// controller (chain/engine.ts), and the production object matcher lives in
// layers/filter.ts. Bind both so the declared TargetSpec is legalized by the
// real pipeline instead of the reference kernel's value-only comparison.
const boundWorld = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "self" ? kernel.controller : value])),
    object
  ))
});

function resolveWith(kernel, { gearRef, acceptKill, acceptPlay = false }) {
  kernel.setTargets(TARGET_ID, gearRef === undefined ? [] : [gearRef]);
  kernel.setAnswers({
    [MAY_KILL_ID + "/optional"]: acceptKill,
    ...(acceptKill ? { [MAY_PLAY_ID + "/optional"]: acceptPlay } : {})
  });
  return resolveChainBody([mayKill], boundWorld(kernel));
}

test("sfd-084-221 Jayce, Man of Progress: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost " +
      "no more than :rb_energy_7: from hand this turn, ignoring its Energy cost. (You must still pay " +
      "its Power cost.)"
  );
});

test("sfd-084-221 Jayce, Man of Progress: judgeReason names the receipt, cost, window and filter gaps", () => {
  assert.match(program.judgeReason, /359\.3\.e\.14\.b/);
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /355\.5/);
  assert.match(program.judgeReason, /killed/);
  assert.match(program.judgeReason, /linkedTo/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /finalized cost plan/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-084-221 Jayce, Man of Progress: the may-kill wraps the kill plus the may-play in one optional body", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });

  assert.deepEqual(ability.body.map((instruction) => instruction.id), [MAY_KILL_ID]);
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(mayKill.args.body.kind, "constant");
  assert.deepEqual(mayKill.args.body.value.map((instruction) => instruction.id), [
    KILL_ID,
    MAY_PLAY_ID
  ]);

  // 355.7 / 355.9.a.1 / 355.12 / 190.6.d: "a friendly gear" is one chosen Board
  // object controlled by this ability's controller, locked with the may-action.
  assert.equal(mayKill.targets.length, 1);
  const [target] = mayKill.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, { type: "gear", zone: "board", controller: "self" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");

  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, { target: { kind: "constant", value: TARGET_ID } });
  assert.equal(killInstruction.linkedTo, undefined);
});

test("sfd-084-221 Jayce, Man of Progress: the play node is gated on the kill's 'killed' receipt (359.3.e.14.b)", () => {
  // effect.kill links the destroyed objects as "killed" (an empty array when
  // nothing was destroyed); the may-play node reads that receipt and runs only
  // when something was actually killed.
  assert.equal(mayPlay.linkedTo, KILL_ID);
  assert.deepEqual(mayPlay.condition, {
    kind: "compare",
    left: { kind: "linked", instructionId: KILL_ID, key: "killed" },
    operator: "ne",
    right: { kind: "constant", value: [] }
  });
});

test("sfd-084-221 Jayce, Man of Progress: the play half records the printed ceilings, the pick and the ignored-Energy plan", () => {
  assert.equal(mayPlay.op, "choice.optional");
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => instruction.id), [PLAY_ID]);

  assert.equal(playInstruction.op, "effect.play");
  // 420.3 / 420.3.c: a game effect that plays a card from hand; the object is
  // chosen at resolution from a hidden zone, so it is not a Board target.
  assert.deepEqual(playInstruction.args.pick, { kind: "constant", value: "jayce.gear-in-hand" });
  assert.equal(playInstruction.args.location, undefined);
  assert.equal(playInstruction.linkedTo, undefined);
  // The receipt gate lives on the may-play node (see judgeReason); the play
  // instruction itself stays unconditional — the "this turn" one-shot window
  // is still the unmerged dependency, not a condition on this node.
  assert.equal(playInstruction.condition, undefined);

  // 356.1.b.2: "ignoring its Energy cost" sets only the base Energy to zero and
  // keeps the Power cost; the concrete numbers need the chosen card's printed
  // values, which only the cost pipeline can bind (unmerged).
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: ["printed"], xp: 0, ignoreEnergyOnly: true }
  });

  // 206: the Energy ceiling is a printed-cost comparison; the frozen ObjectFilter
  // has no cost predicate, so the key is descriptive only (see judgeReason).
  assert.equal(playInstruction.picks.length, 1);
  const [pick] = playInstruction.picks;
  assert.equal(pick.id, "jayce.gear-in-hand");
  assert.deepEqual(pick.filter, {
    zone: "hand",
    type: "gear",
    owner: "self",
    costEnergyLte: 7
  });
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
});

test("sfd-084-221 Jayce, Man of Progress golden: accepting the may-kill kills the locked friendly gear", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("friendly-gear", { types: ["gear"], owner: "A", controller: "A" })
    .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
    .build();
  const gearRef = kernel.ref("friendly-gear");
  // Isolate the merged kill half: the play half needs the unmerged cost plan and
  // permission window, so its own effect.play scenario is asserted separately.
  kernel.setTargets(TARGET_ID, [gearRef]);
  kernel.setAnswers({ [MAY_KILL_ID + "/optional"]: true });
  const outcome = resolveChainBody([{
    ...mayKill,
    args: {
      ...mayKill.args,
      body: { kind: "constant", value: [killInstruction] }
    }
  }], boundWorld(kernel));

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, KILL_ID).result.status, "executed");
  assert.deepEqual(kernel.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  // "a friendly gear": the opponent's gear was never a legal target.
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("sfd-084-221 Jayce, Man of Progress chain golden: the killed receipt gates the may-play offer", () => {
  const base = world().player("A", { energy: 10 }).player("B")
    .hand("jayce", { cardId: CARD_ID, types: ["unit"], might: 4, energy: 0, power: [] })
    .unit("friendly-gear", { types: ["gear"], owner: "A", controller: "A" }).build();
  const runScenario = ({ acceptKill, acceptPlay, replaceKill = false }) => {
    const kernel = base.clone();
    const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
    const answers = [];
    const decide = (request) => {
      answers.push(request);
      if (request.type === "optional") return String(request.prompt).includes("Kill") ? acceptKill : acceptPlay;
      if (request.type === "select-objects") {
        return request.options.slice(0, request.min ?? 1);
      }
      throw new Error(`unexpected choice ${JSON.stringify(request)}`);
    };
    const host = createActionPipelineHost({
      checkpoint: () => kernel.snapshot(),
      restore: (state) => kernel.restore(state),
      objects: () => kernel.objects,
      perform: (action) => kernel.perform(action),
      choose: (request) => decide({ ...request, scope: "host" }),
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
    });
    const engine = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
      describePlay: (action, source) => describePlay(registry, action, source),
      cleanup: (chain) => {
        chain.layers.setObjects(kernel.objects);
        let changed = false;
        for (const object of chain.layers.evaluateAll()) {
          if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
              (object.might <= 0 || object.damage >= object.might)) {
            chain.commit({ type: "kill", object: object.ref });
            changed ||= kernel.getObject(object.ref.id)?.ref.zoneEntryId !== object.ref.zoneEntryId;
          }
        }
        return changed;
      }
    });
    if (replaceKill) {
      // Bind an actual replacement to the pipeline: the attempted kill returns
      // the gear to hand instead. No TestWorld replacement callback is used.
      bindReplacement({
        replaces: { event: "object-killed", filter: { objectId: "friendly-gear" } },
        with: [{
          id: "return-gear-instead", op: "effect.zone",
          args: {
            target: { kind: "constant", value: { linked: "replacement.object" } },
            to: { kind: "constant", value: "hand" }
          }
        }]
      }, kernel.ref("jayce"), {
        host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context: host.context },
        pipeline: engine.pipeline
      });
    }
    attachProgramLifecycle(engine, registry, undefined, (error) => { throw error; });
    engine.execute(describePlay(registry, { type: "play", object: kernel.ref("jayce"), player: "A" }, kernel.getObject("jayce")));
    while (engine.items.length) engine.pass(engine.priority);
    return { kernel, answers, engine };
  };

  // A completed kill offers the may-play choice; declining it there stops the play.
  const accepted = runScenario({ acceptKill: true, acceptPlay: false });
  assert.equal(accepted.kernel.getObject("friendly-gear").zone, "trash");
  assert.ok(accepted.answers.some((request) => request.type === "optional" && /Play a gear/.test(request.prompt)));

  // "If you do": without a kill there is no play offer at all.
  const declined = runScenario({ acceptKill: false, acceptPlay: false });
  assert.equal(declined.kernel.getObject("friendly-gear").zone, "board");
  assert.ok(!declined.answers.some((request) => request.type === "optional" && /Play a gear/.test(request.prompt)));

  // Accept the outer may-kill, then negate the kill through the real
  // replacement binder. Without the receipt gate the inner may-play WOULD be
  // asked here, which distinguishes this case from declining the outer may.
  const replaced = runScenario({ acceptKill: true, acceptPlay: false, replaceKill: true });
  assert.ok(replaced.answers.some((request) => request.type === "optional" && /Kill a friendly gear/.test(request.prompt)));
  assert.equal(replaced.kernel.getObject("friendly-gear").zone, "hand");
  assert.ok(replaced.engine.pipeline.events.some((event) => event.timingPoint === "object-enters-hand" && event.object.ref.id === "friendly-gear"));
  assert.ok(!replaced.kernel.events.some((event) => event.action === "kill"));
  assert.ok(!replaced.engine.pipeline.events.some((event) => event.timingPoint === "object-killed"));
  assert.ok(!replaced.answers.some((request) => request.type === "optional" && /Play a gear/.test(request.prompt)),
    "a replaced kill must not offer the subsequent play");
});

test("sfd-084-221 Jayce, Man of Progress golden: declining leaves every gear on the Board", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("friendly-gear", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const outcome = resolveWith(kernel, {
    gearRef: kernel.ref("friendly-gear"),
    acceptKill: false
  });

  assert.deepEqual(outcome.results.map((entry) => entry.id), [MAY_KILL_ID]);
  assert.equal(resultFor(outcome, MAY_KILL_ID).result.status, "negated");
  assert.equal(resultFor(outcome, MAY_KILL_ID).result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.deepEqual(outcome.events, []);
});

test("sfd-084-221 Jayce, Man of Progress golden: a gear that left the Board makes the may node ignored (359.3.e)", () => {
  const kernel = world()
    .unit("jayce", { might: 4 })
    .unit("fleeing-gear", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const stale = kernel.ref("fleeing-gear");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const outcome = resolveWith(kernel, { gearRef: stale, acceptKill: true });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(resultFor(outcome, MAY_KILL_ID).result, {
    status: "ignored",
    reason: "mistargeted"
  });
  // The ignored may node suppresses its children (contract 3.4).
  assert.equal(resultFor(outcome, KILL_ID), undefined);
  assert.equal(kernel.getObject("fleeing-gear").zone, "hand");
});

test("sfd-084-221 Jayce, Man of Progress golden: the merged play primitive plays the locked gear with a finalize-supplied plan", () => {
  const kernel = world().player("A").hand("steraks-gage", { types: ["gear"], owner: "A", controller: "A" }).build();
  const run = runInstruction(
    play,
    {
      pick: "jayce.gear-in-hand",
      cost: {
        kind: "constant",
        // 356.1.b.2: Energy ignored (0), Power still owed — the golden supplies
        // the finalized plan the cost pipeline must produce.
        value: { finalized: true, energy: 0, power: ["Mind"], xp: 0 }
      },
      linkKey: "played"
    },
    { world: kernel, picks: { "jayce.gear-in-hand": [kernel.ref("steraks-gage")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("steraks-gage").zone, "board");
});

test.todo(
  "sfd-084-221 Jayce, Man of Progress: enforce 'a gear with Energy cost no more than 7' as a working " +
    "printed-cost restriction (CR 206; the ObjectFilter has no printed-cost predicate)"
);
test.todo(
  "sfd-084-221 Jayce, Man of Progress: generate the ignore-Energy-only cost plan (356.1.b.2) for the chosen " +
    "hand card and provide the 'this turn' one-shot play permission window (355.5) — programs/play.ts " +
    "translateCost turns the card's cost fields into judge-required and cost/ has no card-program ignore-base " +
    "entry"
);
