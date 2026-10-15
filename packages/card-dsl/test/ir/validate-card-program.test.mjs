import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../dist/index.js";

const constant = value => ({ kind: "constant", value });
const condition = {
  kind: "compare",
  left: constant(1),
  operator: "eq",
  right: constant(1)
};
const target = {
  id: "chosen",
  filter: { type: "unit", controller: "opponent" },
  min: 1,
  max: 1,
  selection: "one"
};
const pick = {
  id: "mode",
  options: ["draw", "damage"],
  min: 1,
  max: 1,
  selection: "one"
};

const instruction = (id, op, extra = {}) => ({
  id,
  op,
  args: { amount: constant(1) },
  ...extra
});

const program = (canonicalCardId, abilities, extra = {}) => ({
  canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "test card text",
  ...extra
});

const validPrograms = [
  program("set.keyword", [{ kind: "keyword", keyword: "assault", value: 2 }]),
  program("set.triggered", [{
    kind: "triggered",
    trigger: { at: "card.played", filter: { type: "unit" } },
    optional: false,
    body: [instruction("draw", "draw.cards")]
  }]),
  program("set.activated", [{
    kind: "activated",
    cost: { energy: constant(2) },
    timing: "action",
    body: [instruction("damage", "deal.damage", { targets: [target] })],
    restriction: { kind: "your-turn" }
  }]),
  program("set.static", [{
    kind: "static",
    effect: { kind: "modify-might", value: constant(1) },
    condition
  }]),
  program("set.replacement", [{
    kind: "replacement",
    replaces: { event: "damage.dealt", filter: { target: "self" } },
    with: [instruction("prevent", "prevent.damage")]
  }]),
  program("set.play", [{
    kind: "play",
    cost: { payments: [{ kind: "energy", amount: constant(3) }] },
    body: [instruction("move", "move.zone", { targets: [target] })],
    requirements: [{ kind: "control", value: constant("self") }]
  }]),
  program("set.linked", [{
    kind: "play",
    body: [
      instruction("choose", "choose.mode", { picks: [pick] }),
      instruction("resolve", "resolve.mode", {
        linkedTo: "choose",
        condition: { kind: "expression", value: constant(true) }
      })
    ]
  }]),
  program("set.pick", [{
    kind: "play",
    body: [instruction("pick", "choose.mode", { picks: [pick] })]
  }]),
  program("set.condition", [{
    kind: "triggered",
    trigger: {
      at: "turn.started",
      filter: { event: "turn.started", filter: { player: "self" } },
      once: "per-turn",
      condition: { kind: "all", conditions: [condition] }
    },
    optional: true,
    body: [instruction("conditional", "gain.energy", { condition })]
  }]),
  program("set.deckbuilding", [], {
    deckbuilding: [{
      kind: "choose-legend",
      options: ["legend.alpha", "legend.beta"],
      count: 1
    }]
  }),
  program("set.mixed", [
    { kind: "keyword", keyword: "shield" },
    {
      kind: "play",
      body: [
        instruction("first", "create.token"),
        instruction("second", "attach", { linkedTo: "first" })
      ]
    }
  ]),
  program("set.judge", [], {
    status: "judge-required",
    judgeReason: "The official replacement timing is not yet sourced."
  })
];

test("accepts representative EffectIR v2 CardPrograms", () => {
  assert.equal(validPrograms.length, 12);
  for (const candidate of validPrograms) {
    const result = validateCardProgram(candidate);
    assert.equal(result.ok, true, `${candidate.canonicalCardId}: ${JSON.stringify(result)}`);
  }
});

const invalidPrograms = [
  ["$.rulesetVersion", program("bad.ruleset", [], { rulesetVersion: "core-1.4" })],
  ["$.judgeReason", program("bad.judge", [], { status: "judge-required" })],
  ["$.abilities[0].keyword", program("bad.keyword", [{ kind: "keyword", keyword: "Bad Keyword" }])],
  ["$.abilities[0].body[0].op", program("bad.op", [{ kind: "play", body: [instruction("bad", "Bad Opcode")] }])],
  ["$.abilities[0].body[1].id", program("bad.duplicate", [{
    kind: "play",
    body: [instruction("same", "one"), instruction("same", "two")]
  }])],
  ["$.abilities[0].body[0].linkedTo", program("bad.forward-link", [{
    kind: "play",
    body: [instruction("first", "one", { linkedTo: "second" }), instruction("second", "two")]
  }])],
  ["$.abilities", program("bad.no-ability", [
    { kind: "keyword", keyword: "shield" }
  ], { status: "no-ability" })],
  ["$.abilities[0].body[0].targets[0].filter", program("bad.target", [{
    kind: "play",
    body: [instruction("target", "choose", { targets: [{ id: "chosen", filter: [] }] })]
  }])],
  ["$.abilities[0].body[0].condition.operator", program("bad.condition", [{
    kind: "play",
    body: [instruction("condition", "conditional", { condition: { ...condition, operator: "maybe" } })]
  }])],
  ["$.sourceText", {
    canonicalCardId: "bad.source",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "no-ability",
    abilities: []
  }]
];

test("rejects malformed programs with actionable paths", () => {
  assert.equal(invalidPrograms.length, 10);
  for (const [expectedPath, candidate] of invalidPrograms) {
    const result = validateCardProgram(candidate);
    assert.equal(result.ok, false, `Expected ${expectedPath} to be rejected.`);
    assert.ok(
      result.issues.some(issue => issue.path === expectedPath || issue.path.startsWith(expectedPath)),
      `${expectedPath} missing from ${JSON.stringify(result.issues)}`
    );
  }
});

