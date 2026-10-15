// Validated against the actual 2026-10-12 official catalog; no card text overrides.
import type { DeckSubmission } from "@riftbound/protocol";

export const fury77RealDecks = {
  "a": {
    "mainDeck": [
      {
        "cardId": "ogn-001-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-010-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-013-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-210-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-215-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-219-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-234-298",
        "quantity": 3
      },
      {
        "cardId": "ogs-016-024",
        "quantity": 3
      },
      {
        "cardId": "sfd-006-221",
        "quantity": 3
      },
      {
        "cardId": "sfd-156-221",
        "quantity": 3
      },
      {
        "cardId": "ogn-209-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-229-298",
        "quantity": 3
      },
      {
        "cardId": "unl-180-219",
        "quantity": 3
      }
    ],
    "runes": [
      {
        "cardId": "ogn-007-298",
        "quantity": 6
      },
      {
        "cardId": "ogn-214-298",
        "quantity": 6
      }
    ],
    "legend": [
      {
        "cardId": "unl-187-219",
        "quantity": 1
      }
    ],
    "champion": [
      {
        "cardId": "ogn-036-298",
        "quantity": 1
      }
    ],
    "battlefields": [
      {
        "cardId": "ogn-275-298",
        "quantity": 1
      },
      {
        "cardId": "ogn-278-298",
        "quantity": 1
      },
      {
        "cardId": "ogn-280-298",
        "quantity": 1
      }
    ]
  },
  "b": {
    "mainDeck": [
      {
        "cardId": "ogn-001-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-010-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-013-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-210-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-215-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-219-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-234-298",
        "quantity": 3
      },
      {
        "cardId": "ogs-016-024",
        "quantity": 3
      },
      {
        "cardId": "sfd-006-221",
        "quantity": 3
      },
      {
        "cardId": "sfd-156-221",
        "quantity": 3
      },
      {
        "cardId": "ogn-209-298",
        "quantity": 3
      },
      {
        "cardId": "ogn-229-298",
        "quantity": 3
      },
      {
        "cardId": "unl-180-219",
        "quantity": 1
      },
      {
        "cardId": "ogn-036-298",
        "quantity": 2
      }
    ],
    "runes": [
      {
        "cardId": "ogn-007-298",
        "quantity": 7
      },
      {
        "cardId": "ogn-214-298",
        "quantity": 5
      }
    ],
    "legend": [
      {
        "cardId": "unl-187-219",
        "quantity": 1
      }
    ],
    "champion": [
      {
        "cardId": "ogn-036-298",
        "quantity": 1
      }
    ],
    "battlefields": [
      {
        "cardId": "ogn-275-298",
        "quantity": 1
      },
      {
        "cardId": "ogn-278-298",
        "quantity": 1
      },
      {
        "cardId": "ogn-280-298",
        "quantity": 1
      }
    ]
  }
} as const satisfies Readonly<Record<"a" | "b", DeckSubmission>>;
