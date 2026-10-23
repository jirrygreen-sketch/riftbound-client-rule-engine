import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import amateurDemolitionist from "../../../dist/cards/rad/amateur-demolitionist.js";
import blackMarketBroker from "../../../dist/cards/sfd/black-market-broker.js";
import gold from "../../../dist/cards/sfd/gold.js";
import troveGolem from "../../../dist/cards/sfd/trove-golem.js";

// The shipped programs remain judge-required for their non-Gold gaps. These
// executable views use the card's own token instruction and register the
// canonical Gold program with the scenario. That lets the shared card-played ->
// effect.token path create the real definition without substituting another.
function executableView(program, { concreteBase = false } = {}) {
  const abilities = concreteBase
    ? program.abilities.map((ability) => ability.kind === "triggered"
      ? {
          ...ability,
          body: ability.body.map((instruction) => {
            const args = Object.fromEntries(
              Object.entries(instruction.args)
            );
            args.location = { kind: "constant", value: { type: "base", player: "A" } };
            return { ...instruction, args };
          })
        }
      : ability)
    : program.abilities;
  return { ...program, status: "executable", judgeReason: undefined, abilities };
}

const amateur = executableView(amateurDemolitionist);
const black = executableView(blackMarketBroker, { concreteBase: true });
const trove = executableView(troveGolem, { concreteBase: true });

const rows = [
  {
    name: "Amateur Demolitionist · Bomb play is blocked by the missing definition",
    canonicalCardId: amateurDemolitionist.canonicalCardId,
    program: amateur,
    scenario: {
      objects: [
        {
          id: "demolitionist",
          cardId: amateurDemolitionist.canonicalCardId,
          types: ["unit"],
          zone: "board",
          location: { type: "base", player: "A" },
          might: 1
        },
        {
          id: "battlefield",
          owner: "A",
          types: ["battlefield"],
          zone: "board",
          location: { type: "battlefield", id: "bf-1" },
          energy: null,
          power: null,
          might: null
        }
      ],
      answers: { "amateur-demolitionist.battlefield": ["battlefield"] },
      operations: [
        { type: "trigger", timingPoint: "card-played", object: "demolitionist", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          demolitionist: {
            zone: "board",
            location: { type: "base", player: "A" },
            owner: "A",
            controller: "A",
            might: 1,
            exhausted: false,
            damage: 0,
            isToken: false
          },
          battlefield: {
            zone: "board",
            location: { type: "battlefield", id: "bf-1" },
            owner: "A",
            controller: "A",
            exhausted: false,
            damage: 0,
            isToken: false
          }
        },
        players: { A: { energy: 0 }, B: { energy: 0 } },
        events: {
          sequence: [
            { timingPoint: "card-played", reason: "card-played", player: "A" },
            { timingPoint: "chain-item-pending", reason: "chain-item-pending", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-finalize", reason: "chain-item-finalize", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-resolve", reason: "chain-item-resolve", player: "A", details: { item: "trigger:1" } }
          ]
        },
        links: {
          "amateur-demolitionist.play-bomb.token": {
            amount: 0,
            objects: [],
            objectsComplete: true
          },
          "amateur-demolitionist.play-bomb.token.amount": 0,
          "amateur-demolitionist.play-bomb.token.objects": []
        }
      }
    }
  },
  {
    name: "Black Market Broker · facedown provenance reaches the canonical Gold play",
    canonicalCardId: blackMarketBroker.canonicalCardId,
    program: black,
    tokenProgram: gold,
    scenario: {
      objects: [
        {
          id: "broker",
          cardId: blackMarketBroker.canonicalCardId,
          types: ["unit"],
          zone: "board",
          location: { type: "base", player: "A" },
          might: 3
        }
      ],
      operations: [
        {
          type: "trigger",
          timingPoint: "card-played",
          object: "broker",
          player: "A",
          details: { fromZone: "facedown", playedFromZone: "facedown" }
        },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          broker: {
            zone: "board",
            location: { type: "base", player: "A" },
            owner: "A",
            controller: "A",
            might: 3,
            exhausted: false,
            damage: 0,
            isToken: false
          }
        },
        players: { A: { energy: 0 }, B: { energy: 0 } },
        events: {
          sequence: [
            {
              timingPoint: "card-played",
              reason: "card-played",
              player: "A",
              details: { fromZone: "facedown", playedFromZone: "facedown" }
            },
            { timingPoint: "chain-item-pending", reason: "chain-item-pending", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-finalize", reason: "chain-item-finalize", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-resolve", reason: "chain-item-resolve", player: "A", details: { item: "trigger:1" } }
          ]
        },
        links: {
          "black-market-broker.play-gold-token.goldToken": {
            amount: 1,
            objects: [{ id: "token-1", zoneEntryId: 1 }],
            objectsComplete: true,
            createdAmount: 1,
            createdObjects: [{ id: "token-1", zoneEntryId: 1 }]
          },
          "black-market-broker.play-gold-token.goldToken.amount": 1,
          "black-market-broker.play-gold-token.goldToken.objects": [{ id: "token-1", zoneEntryId: 1 }],
          "black-market-broker.play-gold-token.goldToken.createdAmount": 1,
          "black-market-broker.play-gold-token.goldToken.createdObjects": [{ id: "token-1", zoneEntryId: 1 }]
        }
      }
    }
  },
  {
    name: "Trove Golem · four Gold plays create and play canonical tokens",
    canonicalCardId: troveGolem.canonicalCardId,
    program: trove,
    tokenProgram: gold,
    scenario: {
      objects: [
        {
          id: "golem",
          cardId: troveGolem.canonicalCardId,
          types: ["unit"],
          zone: "board",
          location: { type: "base", player: "A" },
          might: 9
        }
      ],
      operations: [
        { type: "trigger", timingPoint: "card-played", object: "golem", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          golem: {
            zone: "board",
            location: { type: "base", player: "A" },
            owner: "A",
            controller: "A",
            might: 9,
            exhausted: false,
            damage: 0,
            isToken: false
          }
        },
        players: { A: { energy: 0 }, B: { energy: 0 } },
        events: {
          sequence: [
            { timingPoint: "card-played", reason: "card-played", player: "A" },
            { timingPoint: "chain-item-pending", reason: "chain-item-pending", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-finalize", reason: "chain-item-finalize", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-resolve", reason: "chain-item-resolve", player: "A", details: { item: "trigger:1" } }
          ]
        },
        links: {
          "trove-golem.play-gold-tokens.goldTokens": {
            amount: 4,
            objects: [
              { id: "token-1", zoneEntryId: 1 },
              { id: "token-2", zoneEntryId: 1 },
              { id: "token-3", zoneEntryId: 1 },
              { id: "token-4", zoneEntryId: 1 }
            ],
            objectsComplete: true,
            createdAmount: 4,
            createdObjects: [
              { id: "token-1", zoneEntryId: 1 },
              { id: "token-2", zoneEntryId: 1 },
              { id: "token-3", zoneEntryId: 1 },
              { id: "token-4", zoneEntryId: 1 }
            ]
          },
          "trove-golem.play-gold-tokens.goldTokens.amount": 4,
          "trove-golem.play-gold-tokens.goldTokens.objects": [
            { id: "token-1", zoneEntryId: 1 },
            { id: "token-2", zoneEntryId: 1 },
            { id: "token-3", zoneEntryId: 1 },
            { id: "token-4", zoneEntryId: 1 }
          ],
          "trove-golem.play-gold-tokens.goldTokens.createdAmount": 4,
          "trove-golem.play-gold-tokens.goldTokens.createdObjects": [
            { id: "token-1", zoneEntryId: 1 },
            { id: "token-2", zoneEntryId: 1 },
            { id: "token-3", zoneEntryId: 1 },
            { id: "token-4", zoneEntryId: 1 }
          ]
        }
      }
    }
  },
  {
    name: "Black Market Broker · a hand play does not satisfy the facedown condition",
    canonicalCardId: blackMarketBroker.canonicalCardId,
    program: black,
    scenario: {
      objects: [
        {
          id: "broker",
          cardId: blackMarketBroker.canonicalCardId,
          types: ["unit"],
          zone: "board",
          location: { type: "base", player: "A" },
          might: 3
        }
      ],
      operations: [
        {
          type: "trigger",
          timingPoint: "card-played",
          object: "broker",
          player: "A",
          details: { fromZone: "hand", playedFromZone: "hand", playedFromHand: true }
        }
      ],
      expect: {
        objects: {
          broker: {
            zone: "board",
            location: { type: "base", player: "A" },
            owner: "A",
            controller: "A",
            might: 3,
            exhausted: false,
            damage: 0,
            isToken: false
          }
        },
        events: {
          exact: [
            {
              timingPoint: "card-played",
              reason: "card-played",
              player: "A",
              details: { fromZone: "hand", playedFromZone: "hand", playedFromHand: true }
            },
            { timingPoint: "cleanup-start" },
            { timingPoint: "cleanup-end" }
          ]
        },
        links: {}
      }
    }
  },
  {
    name: "Amateur Demolitionist · no battlefield is a legal pick",
    canonicalCardId: amateurDemolitionist.canonicalCardId,
    program: amateur,
    scenario: {
      objects: [
        {
          id: "demolitionist",
          cardId: amateurDemolitionist.canonicalCardId,
          types: ["unit"],
          zone: "board",
          location: { type: "base", player: "A" },
          might: 1
        }
      ],
      operations: [
        { type: "trigger", timingPoint: "card-played", object: "demolitionist", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          demolitionist: {
            zone: "board",
            location: { type: "base", player: "A" },
            owner: "A",
            controller: "A",
            might: 1,
            exhausted: false,
            damage: 0,
            isToken: false
          }
        },
        players: { A: { energy: 0 }, B: { energy: 0 } },
        events: {
          sequence: [
            { timingPoint: "card-played", reason: "card-played", player: "A" },
            { timingPoint: "chain-item-pending", reason: "chain-item-pending", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-finalize", reason: "chain-item-finalize", player: "A", details: { item: "trigger:1" } },
            { timingPoint: "chain-item-resolve", reason: "chain-item-resolve", player: "A", details: { item: "trigger:1" } }
          ]
        },
        links: {
          "amateur-demolitionist.play-bomb.token": {
            amount: 0,
            objects: [],
            objectsComplete: true
          },
          "amateur-demolitionist.play-bomb.token.amount": 0,
          "amateur-demolitionist.play-bomb.token.objects": []
        }
      }
    }
  }
];

for (const row of rows) {
  const scenarioTokens = row.tokenProgram === undefined ? [] : [{
    id: `triggered-card-played-661:${row.canonicalCardId}`,
    cardId: row.tokenProgram.canonicalCardId,
    program: row.tokenProgram,
    owner: "A",
    controller: "A",
    types: ["gear"],
    zone: "hand",
    location: null,
    energy: null,
    power: null,
    might: null,
  }];
  const scenario = row.tokenProgram === undefined
    ? row.scenario
    : { ...row.scenario, objects: [...(row.scenario.objects ?? []), ...scenarioTokens] };
  const [testCase] = defineTemplateSuite("triggered card-played effect.token 661", [{
    ...row,
    scenario,
  }]);
  test(testCase.name, testCase.run);
}
