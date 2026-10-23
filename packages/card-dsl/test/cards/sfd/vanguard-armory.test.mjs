import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/vanguard-armory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { buildCostPlan } = await import(new URL("cost/index.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { queryLocationCandidates } = await import(new URL("target/location/index.js", ENGINE));
const token = (await import(new URL("effects/instructions/effect.token.js", ENGINE))).default;

const CANONICAL = "card.hash-1a195f8245b52279e6972886278ad1ad1a5802773ad4affa1e6ecff419aad1aa";
const SOURCE_TEXT =
  ":rb_exhaust:: Play three 1 :rb_might: Recruit unit tokens. (You may play them to different locations.)";

const [ability] = program.abilities;
const [playRecruits] = ability.body;

/** Vanguard Armory on the Board, ready. */
function armoryWorld({ exhausted = false } = {}) {
  const base = world()
    .player("A")
    .object("vanguard-armory", {
      name: "Vanguard Armory",
      cardId: CANONICAL,
      types: ["gear"],
      tags: [],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 7,
      power: ["Order"],
      might: null,
      exhausted
    })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("vanguard-armory") });
}

test("sfd-168-221 Vanguard Armory: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the measured remaining gap. The
  // per-token choice itself is expressible (see the repeat golden below); what
  // is missing is the 355.2.a candidate source that would enumerate an empty
  // controlled battlefield.
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /candidates\.ts/);
  assert.match(program.judgeReason, /allRefs/);
  assert.match(program.judgeReason, /repeat/);
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /linked-value/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-168-221 Vanguard Armory: one action-speed activated ability costing Exhaust this", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 151.2: Gear activations default to Action timing (no printed [Reaction]).
  assert.equal(ability.timing, "action");
  // 204.1.b / 415.3.a / 415.5: the printed ":rb_exhaust:" before the colon is the
  // activation cost "Exhaust this".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(ability.restriction, undefined);
});

test("sfd-168-221 Vanguard Armory: three Recruit tokens played through the chain, no fixed location", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(playRecruits.id, "vanguard-armory.play-recruits");
  assert.equal(playRecruits.op, "effect.token");
  // CR 187.1: the frozen Recruit definition (1 Might unit token, no printed cost).
  assert.deepEqual(playRecruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruits.args.amount, { kind: "constant", value: 3 });
  // 440.2.c / 185.2.a: a NEW token is created on the Chain and handed to play.
  assert.deepEqual(playRecruits.args.mode, { kind: "constant", value: "play" });
  // 355.2/355.2.a: each token's location is chosen when it is played. The
  // shipped program pins no location here (writing one Base or one Battlefield
  // would delete the printed option); the merged repeat + effect.token +
  // linked-location path that can express the per-token choice is exercised by
  // the golden below.
  assert.equal(playRecruits.args.location, undefined);
  assert.equal(playRecruits.args.locations, undefined);
  assert.equal(playRecruits.args.choiceId, undefined);
  assert.equal(playRecruits.targets, undefined);
  assert.equal(playRecruits.picks, undefined);
  assert.equal(playRecruits.linkedTo, undefined);
});

test("sfd-168-221 Vanguard Armory golden: the printed Exhaust cost really pays through the merged cost pipeline", () => {
  const context = armoryWorld();
  const plan = buildCostPlan(context, { id: "vanguard-armory", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.total.power, []);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("vanguard-armory").exhausted, true);
});

test("sfd-168-221 Vanguard Armory golden: an already exhausted Gear cannot pay the printed cost (CR 415.4)", () => {
  const context = armoryWorld({ exhausted: true });
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "vanguard-armory", cost: ability.cost })),
    (error) => error?.reason === "cannot-pay-cost"
  );
  assert.equal(context.getObject("vanguard-armory").exhausted, true);
});

test("sfd-168-221 Vanguard Armory golden: the printed token body plays three 1-Might Recruits", () => {
  // The golden supplies the concrete location that the printed per-token choice
  // (355.2/355.2.a) would yield; the program's token/amount/mode come from the
  // card data unchanged.
  const kernel = world().player("A").build();
  const base = { type: "base", player: "A" };
  const run = runInstruction(
    token,
    {
      token: playRecruits.args.token,
      amount: playRecruits.args.amount,
      mode: playRecruits.args.mode,
      location: { kind: "constant", value: base }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 3);
  assert.equal(run.linked.token.createdAmount, 3);
  assert.equal(run.linked.token.objectsComplete, true);
  // 440.2.c / 185.2.a: each token is created on the Chain and then played.
  assert.deepEqual(run.events.map((event) => event.action), [
    "create-token", "play", "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);

  const recruits = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(recruits.length, 3);
  for (const recruit of recruits) {
    // CR 187.1: Recruit is a 1-Might unit token; 185.3 keeps its cost absent.
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.types, ["unit"]);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
    assert.deepEqual(recruit.location, base);
    assert.equal(recruit.controller, "A");
  }
});

test("sfd-168-221 Vanguard Armory golden: each token really chooses its own location through the merged path", () => {
  // 355.2 / 355.2.a: "Play three 1 [M] Recruit unit tokens. (You may play them to
  // different locations.)". The merged interpreter expresses one choice per
  // token: a repeat node iterates the effect.token body, and each iteration
  // resolves its own LocationRef (condition.value + the location "choose"
  // selector) which effect.token consumes through a linked value. Nothing about
  // the token, its amount, or its play mode is substituted here — the points
  // differing from the shipped program are the location arguments the shipped
  // program cannot yet fill (see judgeReason).
  const body = [
    {
      id: "vanguard-armory.play-recruits",
      op: "repeat",
      args: {
        count: { kind: "constant", value: 3 },
        body: {
          kind: "constant",
          value: [
            {
              id: "vanguard-armory.choose-location",
              op: "condition.value",
              args: {
                value: {
                  kind: "location",
                  value: {
                    kind: "choose",
                    id: "vanguard-armory.destination",
                    filter: { controller: "controller" }
                  }
                }
              }
            },
            {
              id: "vanguard-armory.play-recruit",
              op: "effect.token",
              args: {
                token: playRecruits.args.token,
                amount: { kind: "constant", value: 1 },
                mode: playRecruits.args.mode,
                location: {
                  kind: "linked-value",
                  instructionId: "vanguard-armory.choose-location",
                  key: "value"
                }
              }
            }
          ]
        }
      }
    }
  ];

  const baseA = { type: "base", player: "A" };
  const field = { type: "battlefield", id: "bf-a" };
  // Filenames follow the production convention: the battlefield object's ref id
  // is the same id its occupants sit at (game/lifecycle.ts creates battlefields
  // as tokens and uses their id as the location identity).
  const kernel = world()
    .player("A")
    .player("B")
    .object("bf-a", {
      owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null, might: null, energy: null, power: null
    })
    .unit("scout", { owner: "A", controller: "A", location: field, might: 1 })
    .build();

  const asked = [];
  let index = 0;
  const proxy = new Proxy(kernel, {
    get(target, key) {
      if (key === "choose") {
        return (request) => {
          asked.push({ id: request.id, options: request.options });
          // Alternate the two legal locations so the tokens really land apart.
          const answer = request.options[index++ % request.options.length];
          return answer;
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const outcome = resolveChainBody(body, proxy);

  assert.equal(outcome.status, "executed");
  // One location question per token, each with its own choice id.
  assert.equal(asked.length, 3);
  assert.deepEqual(asked.map((entry) => entry.id), [
    "vanguard-armory.play-recruits/0/vanguard-armory.choose-location/vanguard-armory.destination",
    "vanguard-armory.play-recruits/1/vanguard-armory.choose-location/vanguard-armory.destination",
    "vanguard-armory.play-recruits/2/vanguard-armory.choose-location/vanguard-armory.destination"
  ]);
  for (const entry of asked) assert.deepEqual(entry.options, [field, baseA]);

  const recruits = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(recruits.length, 3);
  assert.deepEqual(recruits.map((recruit) => recruit.location), [field, baseA, field]);
  for (const recruit of recruits) {
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.equal(recruit.controller, "A");
  }
});

test("sfd-168-221 Vanguard Armory: the legal-location source includes an empty controlled battlefield (355.2.a)", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .object("bf-a", {
      owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null, might: null, energy: null, power: null
    })
    .object("bf-b", {
      owner: "B", controller: "B", types: ["battlefield"], zone: "board", location: null, might: null, energy: null, power: null
    })
    .build();

  // CR 355.2.a: a controlled empty Battlefield is a legal Play destination.
  assert.deepEqual(
    queryLocationCandidates(kernel, { controller: "controller" }, { players: ["A", "B"] }),
    [{ type: "battlefield", id: "bf-a" }, { type: "base", player: "A" }]
  );
  assert.deepEqual(
    kernel.query({ zone: "board", type: "battlefield" }).map((object) => object.ref.id),
    ["bf-a", "bf-b"],
    "both empty battlefields are real Board objects"
  );
});
