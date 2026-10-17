import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

// README 4.1 的模板级参数化最小示例：每一行只描述一张卡和它的场景。
const canonicalCardId = "card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc";
const cloudDrake = cardProgramsById.get(canonicalCardId);

for (const row of defineTemplateSuite("card template example", [
  {
    name: "Cloud Drake draws on play",
    canonicalCardId,
    program: cloudDrake,
    scenario: {
      objects: [
        { id: "drake", cardId: canonicalCardId, types: ["unit"], zone: "hand", might: 2 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "drake", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { drake: { zone: "board" }, top: { zone: "hand" } },
      },
    },
  },
])) test(row.name, row.run);
