import {
  JUDGE_TOOLS_SCHEMA_VERSION,
  OFFICIAL_RADIANCE_RULESET_ID,
  RULE_FIXTURE_SET_KIND
} from "./types.js";
import type { EvidenceRef, RuleFixtureSet } from "./types.js";
import { parseRuleFixtureSet } from "./validation.js";
export function createOfficialRadianceRuleFixtureSet(): RuleFixtureSet {
  const coreRules: EvidenceRef = {
    sourceType: "official-rule",
    sourceId: "riftbound.core-rules",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    version: "1.5",
    ref: "55"
  };
  const coreRulesAt = (ref: string): EvidenceRef => ({ ...coreRules, ref });
  const officialFaq: EvidenceRef = {
    sourceType: "official-case",
    sourceId: "riftbound.official-faq",
    url: "https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications",
    version: "2026-08-14",
    ref: "article"
  };
  const radiancePatchNotes: EvidenceRef = {
    sourceType: "official-rule",
    sourceId: "riftbound.radiance-patch-notes",
    url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    version: "2026-10-09",
    ref: "article"
  };
  const tournamentRules: EvidenceRef = {
    sourceType: "policy-document",
    sourceId: "riftbound.tournament-rules",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf",
    version: "2026-10-09",
    ref: "article"
  };

  return parseRuleFixtureSet({
    kind: RULE_FIXTURE_SET_KIND,
    schemaVersion: JUDGE_TOOLS_SCHEMA_VERSION,
    id: "official.core-1.5-radiance.2026-10-11",
    rulesetId: OFFICIAL_RADIANCE_RULESET_ID,
    title: "Official Core Rules 1.5 Radiance fixtures",
    summary:
      "Traceable assertions for the published Radiance Core Rules. The fixture records its as-of date and the separate Radiance effective date.",
    asOf: "2026-10-11T00:00:00.000Z",
    sources: [
      coreRulesAt("55"),
      coreRulesAt("55.1"),
      coreRulesAt("107.3.f"),
      coreRulesAt("108.7.c"),
      coreRulesAt("108.7.e"),
      coreRulesAt("124"),
      coreRulesAt("124.1"),
      coreRulesAt("128.2.a"),
      coreRulesAt("128.3"),
      coreRulesAt("128.4"),
      coreRulesAt("128.5"),
      coreRulesAt("128.6"),
      coreRulesAt("128.6.a"),
      coreRulesAt("311"),
      coreRulesAt("312"),
      coreRulesAt("312.2"),
      coreRulesAt("313"),
      coreRulesAt("313.1"),
      coreRulesAt("313.2"),
      coreRulesAt("313.3"),
      coreRulesAt("313.4"),
      coreRulesAt("313.5"),
      coreRulesAt("312.1"),
      coreRulesAt("319"),
      coreRulesAt("320"),
      coreRulesAt("320.1"),
      coreRulesAt("321"),
      coreRulesAt("321.1"),
      coreRulesAt("322"),
      coreRulesAt("322.1"),
      coreRulesAt("333"),
      coreRulesAt("334"),
      coreRulesAt("334.2.a"),
      coreRulesAt("336.1"),
      coreRulesAt("337"),
      coreRulesAt("337.1"),
      coreRulesAt("337.1.a"),
      coreRulesAt("337.1.b"),
      coreRulesAt("337.2"),
      coreRulesAt("340.1"),
      coreRulesAt("341"),
      coreRulesAt("344"),
      coreRulesAt("345"),
      coreRulesAt("346"),
      coreRulesAt("346.1"),
      coreRulesAt("347"),
      coreRulesAt("348"),
      officialFaq,
      radiancePatchNotes,
      tournamentRules
    ],
    sourceLifecycles: [
      {
        sourceId: coreRules.sourceId,
        status: "published",
        publishedAt: "2026-10-09T00:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: "94D41FEE86F88B61C4157C0389C0595D990B98E5B42555C99D9F649EE64D1FEC"
      },
      {
        sourceId: officialFaq.sourceId,
        status: "published",
        publishedAt: "2026-08-14T01:00:00.000Z",
        effectiveAt: "2026-08-14T01:00:00.000Z",
        effectiveUntil: "2026-10-16T00:00:00.000Z",
        sha256: null
      },
      {
        sourceId: radiancePatchNotes.sourceId,
        status: "published",
        publishedAt: "2026-10-09T16:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: null
      },
      {
        sourceId: tournamentRules.sourceId,
        status: "published",
        publishedAt: "2026-10-09T16:00:00.000Z",
        effectiveAt: "2026-10-16T00:00:00.000Z",
        effectiveUntil: null,
        sha256: "CE07DA4FB632526AFBBCE7F058287A57E7444FA6BDE17B0938FF52CE3FAB3D07"
      }
    ],
    cases: [
      {
        id: "source.governance.radiance-effective-window",
        category: "source-governance",
        decision: "auto",
        assertions: [
          {
            id: "source.governance.radiance-effective-window.assert-1",
            statement:
              "A match envelope must not activate the Radiance ruleset before 2026-10-16 even though its sources were published on 2026-10-09.",
            given: {
              checkedAt: "2026-10-11T00:00:00.000Z",
              rulesetVersion: "1.5",
              sourcePublishedAt: "2026-10-09T00:00:00.000Z"
            },
            expected: {
              active: false,
              reason: "published-before-effective-date"
            },
            evidence: [radiancePatchNotes, tournamentRules]
          }
        ]
      },
      {
        id: "chain.finalize.order",
        category: "chain",
        decision: "auto",
        assertions: [
          {
            id: "chain.finalize.order.assert-1",
            statement:
              "Pending Chain Items finalize in the order they were appended and finalization does not pass Priority.",
            given: {
              pendingChainItemIds: ["chain-item-1", "chain-item-2"]
            },
            expected: {
              finalizedOrder: ["chain-item-1", "chain-item-2"],
              priorityPassedOnFinalize: false
            },
            evidence: [coreRulesAt("337.1"), coreRulesAt("337.1.a"), coreRulesAt("337.1.b")]
          },
          {
            id: "chain.finalize.immediate-resolution.exception",
            statement:
              "After finalization, a Unit, Gear, or resource-adding ability resolves immediately rather than waiting for the general newest-first resolution order.",
            given: {
              finalizedItemType: "unit"
            },
            expected: {
              movesToResolveImmediately: true,
              resolutionMode: "finalization-exception"
            },
            evidence: [coreRulesAt("337.2")]
          }
        ]
      },
      {
        id: "chain.resolve.newest-finalized-first",
        category: "chain",
        decision: "auto",
        assertions: [
          {
            id: "chain.resolve.newest-finalized-first.assert-1",
            statement: "The newest finalized Chain Item resolves first.",
            given: {
              finalizedChainItemIds: ["chain-item-1", "chain-item-2"]
            },
            expected: { firstResolvedChainItemId: "chain-item-2" },
            evidence: [coreRulesAt("340.1")]
          }
        ]
      },
      {
        id: "priority.focus.single-holder",
        category: "priority",
        decision: "auto",
        assertions: [
          {
            id: "priority.focus.single-holder.assert-1",
            statement:
              "At most one player holds Priority and at most one player holds Focus.",
            given: { candidatePlayerIds: ["player-1", "player-2"] },
            expected: {
              maxPriorityHolders: 1,
              maxFocusHolders: 1
            },
            evidence: [coreRulesAt("312"), coreRulesAt("313")]
          }
        ]
      },
      {
        id: "focus.priority-coupling",
        category: "focus",
        decision: "auto",
        assertions: [
          {
            id: "focus.priority-coupling.assert-1",
            statement:
              "Gaining Focus also grants Priority; Focus without Priority cannot authorize discretionary actions.",
            given: { focusHolder: "player-1", priorityHolder: null },
            expected: {
              discretionaryActionAllowed: false
            },
            evidence: [
              coreRulesAt("313.2"),
              coreRulesAt("313.4"),
              coreRulesAt("312.1")
            ]
          }
        ]
      },
      {
        id: "focus.showdown-does-not-pass-after-triggered-or-add-chain",
        category: "focus",
        decision: "auto",
        assertions: [
          {
            id: "focus.showdown-does-not-pass-after-triggered-or-add-chain.assert-1",
            statement:
              "After a Showdown chain opened by a triggered ability or Add ability fully resolves, Focus does not pass merely because the turn returns to Open State.",
            given: {
              showdownOpenState: true,
              chainOpener: "triggered-ability"
            },
            expected: { focusPasses: false },
            evidence: [coreRulesAt("346.1")]
          }
        ]
      },
      {
        id: "cleanup.blocks-fepr-priority-focus",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.blocks-fepr-priority-focus.assert-1",
            statement:
              "While Cleanup occurs, finalized Chain Items cannot resolve, and Priority or Focus cannot be passed or awarded.",
            given: { cleanupInProgress: true },
            expected: {
              resolveFinalizedItems: false,
              passOrAwardPriority: false,
              passOrAwardFocus: false
            },
            evidence: [coreRulesAt("320"), coreRulesAt("320.1")]
          }
        ]
      },
      {
        id: "cleanup.recursive-fixed-point",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.recursive-fixed-point.assert-1",
            statement:
              "A state change during Cleanup schedules another Cleanup immediately, repeating until a Cleanup produces no new state change.",
            given: {
              cleanupGeneratesStateChanges: [true, true, false]
            },
            expected: {
              cleanupExecutionCount: 3,
              finalCleanupChangedState: false
            },
            evidence: [coreRulesAt("322"), coreRulesAt("322.1")]
          }
        ]
      },
      {
        id: "cleanup.deferred-during-resolution",
        category: "cleanup",
        decision: "auto",
        assertions: [
          {
            id: "cleanup.deferred-during-resolution.assert-1",
            statement:
              "A qualifying state change during Chain Item resolution schedules an Outstanding Task instead of running Cleanup immediately.",
            given: {
              chainItemResolving: true,
              eventQualifiesForCleanup: true
            },
            expected: {
              cleanupRunsImmediately: false,
              cleanupBecomesOutstandingTask: true
            },
            evidence: [coreRulesAt("321"), coreRulesAt("321.1")]
          }
        ]
      },
      {
        id: "execute.partially-impossible",
        category: "execute-as-much-as-possible",
        decision: "notImplemented",
        assertions: [
          {
            id: "execute.partially-impossible.assert-1",
            statement:
              "The engine must execute possible instructions and ignore impossible instructions while resolving card text.",
            given: {
              instructions: [
                { id: "possible-1", possible: true },
                { id: "impossible-1", possible: false }
              ]
            },
            expected: {
              executedInstructionIds: ["possible-1"],
              ignoredInstructionIds: ["impossible-1"]
            },
            evidence: [coreRulesAt("55")]
          },
          {
            id: "execute.fully-impossible.assert-1",
            statement:
              "A card with only impossible instructions still plays and resolves, with no effect.",
            given: { allInstructionsImpossible: true },
            expected: {
              played: true,
              resolved: true,
              effectsExecuted: []
            },
            evidence: [coreRulesAt("55.1")]
          }
        ]
      },
      {
        id: "privacy.hand-count-public",
        category: "privacy",
        decision: "auto",
        assertions: [
          {
            id: "privacy.hand-count-public.assert-1",
            statement:
              "Hand cards are private, while the number of cards in a hand remains public.",
            given: { zone: "hand", handCardCount: 5 },
            expected: {
              visibleToOwnerOnlyCardFaces: true,
              publicHandCount: 5
            },
            evidence: [
              coreRulesAt("108.7.c"),
              coreRulesAt("108.7.e"),
              coreRulesAt("128.4")
            ]
          }
        ]
      },
      {
        id: "privacy.facedown-zone-public-card-private",
        category: "privacy",
        decision: "auto",
        assertions: [
          {
            id: "privacy.facedown-zone-public-card-private.assert-1",
            statement:
              "A Facedown Zone is public, but a facedown card located there is private.",
            given: { zoneType: "facedown", cardOrientation: "facedown" },
            expected: {
              zonePrivacy: "public",
              cardPrivacy: "private"
            },
            evidence: [coreRulesAt("107.3.f"), coreRulesAt("128.4")]
          }
        ]
      },
      {
        id: "privacy.cannot-compel-typed-secret-choice",
        category: "privacy",
        decision: "prompt",
        assertions: [
          {
            id: "privacy.cannot-compel-typed-secret-choice.assert-1",
            statement:
              "A player may decline an otherwise compelled action on secret or private cards when the action specifies a card type or quality; the ignored instruction is treated as impossible.",
            given: {
              instructionRequiresCardType: true,
              eligibleCardsArePrivate: true
            },
            expected: {
              allowedToDecline: true,
              ignoredInstructionTreatedAs: "impossible"
            },
            evidence: [coreRulesAt("128.6"), coreRulesAt("128.6.a")]
          }
        ]
      },
      {
        id: "object.identity.non-board-boundary",
        category: "object-identity",
        decision: "notImplemented",
        assertions: [
          {
            id: "object.identity.non-board-boundary.assert-1",
            statement:
              "A Game Object that crosses to or from a Non-Board Zone becomes a new object for tracking purposes.",
            given: {
              fromZoneClass: "board",
              toZoneClass: "non-board",
              initialGameObjectId: "object-1"
            },
            expected: {
              createsNewGameObjectId: true,
              preservesOldGameObjectId: false
            },
            evidence: [coreRulesAt("124")]
          },
          {
            id: "object.identity.non-board-boundary.assert-2",
            statement:
              "Crossing a Non-Board boundary also clears tracked temporary modifications such as damage, counters, granted keywords, and statuses.",
            given: {
              crossingNonBoardBoundary: true,
              temporaryModifications: ["damage", "counter", "granted-keyword", "status"]
            },
            expected: {
              retainedTemporaryModifications: []
            },
            evidence: [coreRulesAt("124.1")]
          }
        ]
      },
      {
        id: "judge.required-unknown-card-semantics",
        category: "judge-decision",
        decision: "judgeRequired",
        assertions: [
          {
            id: "judge.required-unknown-card-semantics.assert-1",
            statement:
              "Card text without a supported executable semantic must block automatic resolution and escalate to a judge instead of approximating behavior.",
            given: {
              cardTextSemantic: "unsupported",
              automaticResolutionCandidate: true
            },
            expected: {
              autoResolve: false,
              blockGameFlow: true,
              escalation: "judgeRequired"
            },
            evidence: [officialFaq, coreRulesAt("55")]
          }
        ],
        judgeReason: {
          code: "missing-authoritative-source",
          explanation:
            "No registered official source defines a complete executable semantic for this exact card text and game context.",
          evidence: [officialFaq, coreRulesAt("55")]
        }
      },
      {
        id: "judge.tournament-policy-separate-layer",
        category: "judge-decision",
        decision: "judgeRequired",
        assertions: [
          {
            id: "judge.tournament-policy-separate-layer.assert-1",
            statement:
              "Missed triggers, rewind, and slow-play outcomes are tournament policy decisions and must not be inferred by the Core Rules engine as defaults.",
            given: {
              scenario: "tournament-policy-only",
              coreRulesAnswerAvailable: false
            },
            expected: {
              engineAppliesCoreRules: true,
              engineAppliesTournamentPolicyDefault: false,
              escalation: "judgeRequired"
            },
            evidence: [tournamentRules, coreRulesAt("333")]
          }
        ],
        judgeReason: {
          code: "policy-escalation",
          explanation:
            "The outcome depends on the active tournament policy and the specific facts observed by the judge.",
          evidence: [tournamentRules]
        }
      }
    ]
  });
}
