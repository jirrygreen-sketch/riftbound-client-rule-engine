export const TRIGGER_TEMPLATE_POINTS = {
  "trigger-play": ["card-played"],
  "trigger-leave": ["object-killed", "object-leaves-board"],
  "trigger-combat": ["attack-declared", "defense-declared", "combat-start", "combat-result", "combat-end", "showdown-open"],
  "trigger-score": ["conquer", "hold", "score"],
  "trigger-phase": ["beginning-start", "main-start", "turn-end"],
  "trigger-move": ["object-moved"],
  delayed: ["main-start"],
  "kw-deathknell": ["object-killed"],
  "kw-temporary": ["beginning-start"],
  "kw-hunt": ["conquer", "hold"],
  "kw-vision": ["card-played"],
  "kw-quick-draw": ["card-played"],
  "kw-weaponmaster": ["card-played"],
  "kw-disarm": ["attack-declared"],
  "trigger-state": ["card-played", "object-killed", "object-leaves-board", "object-enters-hand", "object-moved", "object-readied", "object-exhausted", "became-target", "attack-declared", "defense-declared", "conquer", "hold", "score", "combat-start", "combat-result", "combat-end", "showdown-open", "card-drawn", "card-discarded", "damage-dealt", "unit-stunned", "buff-added", "buff-spent", "empowered-changed", "card-recycled", "card-banished", "card-hidden", "card-burned", "cards-looked-at", "object-attached", "might-changed", "ability-activated"]
};

export const ACTION_TEMPLATE_POINTS = {
  draw: ["card-drawn"],
  discard: ["card-discarded"],
  "cost-discard": ["card-discarded"],
  damage: ["damage-dealt"],
  stun: ["unit-stunned"],
  xp: ["xp-gained"],
  buff: ["buff-added", "buff-spent"],
  empower: ["empowered-changed"],
  recycle: ["card-recycled"],
  "cost-recycle": ["card-recycled"],
  banish: ["card-banished"],
  reveal: ["card-revealed"],
  "kw-show-off": ["objects-shown-off"],
  "kw-deathknell": ["object-killed"],
  "kw-temporary": ["beginning-start"],
  "kw-hunt": ["conquer", "hold", "xp-gained"],
  "kw-vision": ["card-played"],
  "kw-quick-draw": ["card-played"],
  "kw-weaponmaster": ["card-played"],
  "kw-disarm": ["attack-declared"],
  move: ["object-moved"],
  attach: ["object-attached"],
  might: ["might-changed"],
  inspect: ["cards-looked-at"],
  "kw-burn": ["card-burned"],
  activated: ["ability-activated"],
  score: ["score", "points-gained"]
};

export const TEMPLATE_RULE_REFS = {
  "trigger-play": ["383.4.a"],
  "trigger-leave": ["383.2.c.3", "383.2.c.3.a"],
  "trigger-combat": ["383.4.e", "383.4.f", "466.2.b", "468.3", "468.7.b"],
  "trigger-score": ["471.1", "471.2", "473.2"],
  "trigger-phase": ["315.2.a.1", "316.4", "317.1.a"],
  "trigger-move": ["421.1", "449"],
  "trigger-state": ["383.1", "383.2.c"],
  delayed: ["391.2", "393"],
  "kw-deathknell": ["808.1.c", "808.1.d"],
  "kw-temporary": ["816.1.b"],
  "kw-hunt": ["823.1.c.1"],
  "kw-vision": ["817.1.b"],
  "kw-quick-draw": ["819.1.d"],
  "kw-weaponmaster": ["821.1.c"],
  "kw-disarm": ["831.1.d"]
};

export const CUE_RULES = [
  [/\bplays?\b|\b(?:am|is|are|'m) played\b/i, ["card-played"]],
  [/\b(?:I|you|units?) attacks?\b/i, ["attack-declared"]],
  [/\bdefends?\b/i, ["defense-declared"]],
  [/\bmoves?\b/i, ["object-moved"]],
  [/\bdie[sd]?\b|\bkills?\b/i, ["object-killed"]],
  [/\bleaves? the board\b/i, ["object-leaves-board"]],
  [/\breturned to a player's hand\b/i, ["object-enters-hand"]],
  [/\bready\b/i, ["object-readied"]],
  [/\bbecomes? exhausted\b/i, ["object-exhausted"]],
  [/\bchooses?\b/i, ["became-target"]],
  [/\bconquers?\b/i, ["conquer"]],
  [/\bholds?\b/i, ["hold"]],
  [/\bscores?\b/i, ["score"]],
  [/\bwins? a combat\b/i, ["combat-result"]],
  [/\bcombat\b.*\bends\b/i, ["combat-end"]],
  [/\bcombat starts\b/i, ["combat-start"]],
  [/\bshowdown begins\b/i, ["showdown-open"]],
  [/\bat the start\b.*\bBeginning Phase\b/i, ["beginning-start"]],
  [/\bat the start\b.*\bMain Phase\b/i, ["main-start"]],
  [/\bat the end\b.*\bturn\b/i, ["turn-end"]],
  [/\bdraws?\b/i, ["card-drawn"]],
  [/\bdiscards?\b/i, ["card-discarded"]],
  [/\btakes? damage\b/i, ["damage-dealt"]],
  [/\bstuns?\b/i, ["unit-stunned"]],
  [/\b(?:you|I) buff\b/i, ["buff-added"]],
  [/\bspend a buff\b/i, ["buff-spent"]],
  [/\bbecomes? empowered\b|\bempower something\b/i, ["empowered-changed"]],
  [/\brecycles?\b/i, ["card-recycled"]],
  [/\bbanish\b/i, ["card-banished"]],
  [/\bhide\b/i, ["card-hidden"]],
  [/\bburn\b/i, ["card-burned"]],
  [/\blook at\b.*\bsee me\b/i, ["cards-looked-at"]],
  [/\battach an Equipment\b/i, ["object-attached"]],
  [/\bbecomes? Mighty\b|\bMight becomes\b|\breduce the Might\b/i, ["might-changed"]],
  [/\buse an activated ability\b/i, ["ability-activated"]]
];

export const CUE_EXCEPTIONS = [
  {
    printingId: "ogn-269-298",
    phrase: "When a buffed unit you control would die",
    kind: "replacement",
    ruleRefs: ["369", "369.1"],
    reason: "The Boss 拦截将要发生的死亡；由 GameAction 替代层处理，不能订阅死亡后的时点。"
  },
  {
    printingId: "ogn-077-298",
    phrase: "The next time a friendly unit would die",
    kind: "replacement",
    ruleRefs: ["369", "369.1"],
    reason: "Zhonya's Hourglass 的 would die / instead 属于替代事件。"
  },
  {
    printingId: "unl-175-219",
    phrase: "The next time it would die this turn",
    kind: "replacement",
    ruleRefs: ["369", "369.1"],
    reason: "Tactical Retreat 的延迟死亡替代在死亡之前处理。"
  },
  {
    printingId: "ogs-020-024",
    phrase: "The next time it dies this turn",
    kind: "replacement-review",
    ruleRefs: ["369.1"],
    reason: "完整句含 recall ... instead；无 would 的死亡句式保留给替代效果审查，不近似成普通死亡触发。"
  },
  {
    printingId: "ogn-023-298",
    phrase: "The next time it dies this turn",
    kind: "replacement-review",
    ruleRefs: ["369.1"],
    reason: "完整句含可选费用及 recall ... instead；需要替代效果审查，不以死亡后触发代替。"
  },
  {
    printingId: "sfd-194-221",
    phrase: "The next time that unit would be dealt damage this turn",
    kind: "replacement",
    ruleRefs: ["438.1", "438.2"],
    reason: "Counter Strike 的防伤在伤害发生前处理，不能视为 damage-dealt。"
  },
  {
    printingId: "ven-036-166",
    phrase: "at the start of their Channel Phase.",
    kind: "passive-restriction",
    ruleRefs: ["315.3", "364"],
    reason: "Sandstone Chimera 限制 Channel 阶段数量，是持续规则改写而非触发能力。"
  }
];

export const LINKED_TRIGGER_CUES = [
  {
    printingId: "unl-139-219",
    phrase: "When they do",
    timingPointIds: ["card-played"],
    ruleRefs: ["395", "395.1", "398"],
    reason: "Bone Skewer 的前句要求对手打出所选单位，they do 引用该次打出。"
  }
];

export function matchTriggerHeader(header) {
  const normalized = header.replace(/[\[\]]/g, "");
  if (/\bwould\b/i.test(normalized)) return [];
  return [...new Set(CUE_RULES.filter(([pattern]) => pattern.test(normalized)).flatMap(([, ids]) => ids))].sort();
}

export function auditAbilityTimingCoverage(survey) {
  const cards = Object.entries(survey.cards);
  const triggerTemplates = survey.templates.filter(template => template.primitives.some(primitive => primitive.startsWith("trigger.")));
  const templateRows = triggerTemplates.map(template => ({
    templateId: template.id,
    identityCount: cards.filter(([, card]) => card.templates.includes(template.id)).length,
    timingPointIds: TRIGGER_TEMPLATE_POINTS[template.id] ?? [],
    ruleRefs: TEMPLATE_RULE_REFS[template.id] ?? []
  }));
  const missingTemplates = templateRows.filter(row => row.timingPointIds.length === 0);
  const observations = [];
  const exceptions = [];
  const missingPhrases = [];
  const marker = /\bwhen(?:ever)?\b|\bat the (?:start|end)\b|\bthe (?:next|first|second|third|\d+(?:st|nd|rd|th)) time\b/gi;
  for (const [canonicalCardId, card] of cards) {
    for (const clause of card.clauses) {
      for (const match of clause.text.matchAll(marker)) {
        const phrase = clause.text.slice(match.index).split(",")[0];
        if (/^the (?:first|second|third|\d+(?:st|nd|rd|th)) time each turn\b/i.test(phrase) &&
            /\bwhen(?:ever)?\b/i.test(clause.text.slice(0, match.index).split(",").at(-1))) continue;
        const entry = { canonicalCardId, printingId: card.primaryPrintingId, phrase };
        const exception = CUE_EXCEPTIONS.find(candidate => candidate.printingId === card.primaryPrintingId && candidate.phrase === phrase);
        if (exception) {
          exceptions.push({ ...entry, ...exception });
          continue;
        }
        const linkedCue = LINKED_TRIGGER_CUES.find(candidate => candidate.printingId === card.primaryPrintingId && candidate.phrase === phrase);
        const timingPointIds = linkedCue?.timingPointIds ?? matchTriggerHeader(phrase);
        if (timingPointIds.length) observations.push({ ...entry, timingPointIds });
        else missingPhrases.push(entry);
      }
    }
  }
  const actionRows = Object.entries(ACTION_TEMPLATE_POINTS).map(([templateId, timingPointIds]) => ({
    templateId,
    identityCount: cards.filter(([, card]) => card.templates.includes(templateId)).length,
    timingPointIds
  }));
  return { templateRows, actionRows, observations, exceptions, missingTemplates, missingPhrases };
}
