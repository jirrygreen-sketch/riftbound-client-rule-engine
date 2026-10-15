import { DefaultPathDriver, PLAYERS, digest, type Player } from "./driver.js";

export interface Scenario {
  readonly id: string;
  readonly seed?: number;
  readonly coverage: readonly string[];
  readonly stop: string;
  readonly run: (driver: DefaultPathDriver) => void;
}

function requireObserved(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function playEarlyLegion(driver: DefaultPathDriver): string {
  driver.mulligan();
  driver.untilTurn(3);
  return driver.playUnit("player-2", "ogn-010-298");
}

function takeField(driver: DefaultPathDriver): string {
  const legion = playEarlyLegion(driver);
  driver.untilTurn(5);
  driver.move("player-2", legion, 0);
  requireObserved(driver.playing().match.scoring.players.find(player => player.playerId === "player-2")?.points === 1,
    "The real conquest did not award a point");
  return legion;
}

export const scenarios: readonly Scenario[] = [
  {
    id: "01-opening-mulligan",
    coverage: ["admit both unmodified real catalog decks", "seeded turn order and battlefield selection",
      "current non-empty mulligan rejection", "both empty-selection mulligans", "private opening hands", "automatic first turn"],
    stop: "Both keep-hand mulligans complete; first Main is ready. PARTIAL: current default P4 rejects the offered two-card replacement (its resource dispatch omits trusted mulligan RNG); the rejection is retained as an observed limitation, not rules correctness.",
    run: driver => {
      const view = driver.view();
      requireObserved(view.match.stage === "setup", "Expected real setup");
      const owner = view.match.setup.currentMulliganOwner as Player;
      const mulligan = driver.action(owner, "mulligan");
      const before = PLAYERS.map(player => digest(driver.view(player)));
      driver.send(owner, { type: "mulligan", selectedUIDs: mulligan.selectableUIDs.slice(0, 2) },
        "attempt-offered-two-card-mulligan", { reject: true });
      requireObserved(JSON.stringify(PLAYERS.map(player => digest(driver.view(player)))) === JSON.stringify(before),
        "Rejected mulligan changed projections");
      driver.mulligan();
      requireObserved(driver.playing().match.frame.phase === "main", "Opening did not reach Main");
    }
  },
  {
    id: "02-multi-turn-resources-draw",
    coverage: ["turn start and end", "automatic channel and draw", "energy exhaust", "power recycle",
      "turn resource expiry and readiness", "both players' hidden hand counts"],
    stop: "Main of turn 6 after five real End commands.",
    run: driver => {
      driver.mulligan();
      const player = driver.playing().match.frame.turnPlayerId as Player;
      const energy = driver.view(player).actions.find(action => action.kind === "rune-energy" && action.enabled);
      requireObserved(energy && energy.kind === "rune-energy", "Missing real energy action");
      driver.send(player, { type: "rune-energy", uid: energy.uid }, "exhaust-rune-for-energy");
      const power = driver.view(player).actions.find(action => action.kind === "rune-power" && action.enabled);
      requireObserved(power && power.kind === "rune-power", "Missing real power action");
      driver.send(player, { type: "rune-power", uid: power.uid }, "recycle-rune-for-power");
      driver.untilTurn(6);
      requireObserved(driver.playing().match.resources.players.every(seat => seat.runePool.energy === 0), "Turn energy did not expire");
    }
  },
  {
    id: "03-unit-optional-choice-payment",
    coverage: ["real Legion Rearguard from hand", "canonical optional choice clock", "accept Accelerate",
      "energy and Fury power funding", "pending payment privacy", "ready Unit entry"],
    stop: "Turn 3: Legion Rearguard enters ready after actual additional cost and payment.",
    run: driver => {
      driver.mulligan();
      driver.untilTurn(3);
      driver.playUnit("player-2", "ogn-010-298", true);
    }
  },
  {
    id: "04-targeted-spell-current-boundary",
    seed: 149,
    coverage: ["real Vengeance in owner's hand", "real enemy unit available to be chosen", "current Spell action allowlist",
      "unsupported official target spell rejected before payment or target choice", "no fabricated resolution"],
    stop: "PARTIAL: default P4 only routes single-effect Draw Spells; this real target Spell has no action/target prompt and is rejected. Successful targeted casting requires a future server/engine change outside this task.",
    run: driver => {
      const targetUID = playEarlyLegion(driver);
      driver.endTurn();
      const player = "player-1";
      const hand = driver.playing(player).match.players.find(seat => seat.playerId === player)!.hand!;
      const spell = hand.find(card => card.cardId === "ogn-229-298");
      requireObserved(spell, "Real target Spell was not dealt");
      requireObserved(driver.playing().match.board.units.some(unit => unit.objectId === targetUID), "Real spell subject is absent");
      requireObserved(!driver.view(player).actions.some(action => action.kind === "play-card" && action.cardUID === spell.uid),
        "The target Spell is now exposed; replace this boundary scenario with successful casting and cite CR v1.5");
      const before = PLAYERS.map(seat => digest(driver.view(seat)));
      const window = driver.action(player, "end-turn");
      driver.send(player, { type: "play-card", cardUID: spell.uid, windowId: window.windowId }, "attempt-real-target-spell", { reject: true });
      requireObserved(JSON.stringify(PLAYERS.map(seat => digest(driver.view(seat)))) === JSON.stringify(before),
        "Rejected Spell changed a player's projection");
    }
  },
  {
    id: "05-movement-combat-conquer-hold",
    coverage: ["paid Units enter exhausted", "later readiness", "standard move", "both showdown focus passes",
      "empty battlefield conquest", "combat attacker and defender choices", "damage and casualty cleanup", "conquest and Hold scoring"],
    stop: "Turn 8 after combat and the surviving conqueror's next Scoring phase.",
    run: driver => {
      const legion = playEarlyLegion(driver);
      driver.endTurn();
      const scorcher = driver.playUnit("player-1", "ogn-001-298");
      driver.endTurn();
      driver.move("player-2", legion, 0);
      driver.endTurn();
      driver.move("player-1", scorcher, 0);
      driver.resolveCombat();
      requireObserved(!driver.playing().match.board.units.some(unit => unit.objectId === legion), "Combat did not kill Legion");
      driver.untilTurn(8);
      requireObserved(driver.playing().match.scoring.players.find(player => player.playerId === "player-1")?.points === 2,
        "Conqueror did not score Conquer and Hold");
    }
  },
  {
    id: "06-play-through-hold-victory",
    coverage: ["real paid Units and turn actions only", "conquer both shared battlefields", "repeated Hold scoring",
      "victory threshold", "terminal projections and room status"],
    stop: "Real Hold victory at 8 points; both room projections have no actions.",
    run: driver => {
      takeField(driver);
      const scorcher = driver.playUnit("player-2", "ogn-001-298");
      driver.untilTurn(7);
      driver.move("player-2", scorcher, 1);
      for (let turn = 0; turn < 10 && driver.playing().match.frame.phase !== "ended"; turn++) driver.endTurn();
      requireObserved(driver.playing().match.frame.phase === "ended", "Script did not reach a real terminal game");
      requireObserved(driver.playing().match.scoring.players.find(player => player.playerId === "player-2")?.points === 8,
        "Terminal score was not 8");
      requireObserved(PLAYERS.every(player => driver.view(player).actions.length === 0), "Terminal actions remained available");
      requireObserved(driver.room.status === "ended", "Room did not observe the runtime victory");
    }
  },
  {
    id: "07-reject-opponent-action",
    coverage: ["authenticated room actor", "opponent cannot use owner's optional Unit play window", "rejection preserves both projections"],
    stop: "One wrong-actor command rejected; the original owner's real action remains enabled.",
    run: driver => {
      driver.mulligan();
      const owner = "player-2";
      const opponent = "player-1";
      const play = driver.action(owner, "play-card");
      const before = PLAYERS.map(player => digest(driver.view(player)));
      driver.send(opponent, { type: "play-card", cardUID: play.cardUID, windowId: play.windowId }, "reject-opponent-unit-play", { reject: true });
      requireObserved(JSON.stringify(PLAYERS.map(player => digest(driver.view(player)))) === JSON.stringify(before),
        "Wrong-actor command changed projections");
    }
  },
  {
    id: "08-reject-stale-version",
    coverage: ["state version guard", "valid current window with stale expectedVersion", "rejection preserves both projections", "fresh retry succeeds"],
    stop: "Stale End rejected, then a fresh End advances to the next Main turn.",
    run: driver => {
      driver.mulligan();
      const owner = driver.playing().match.frame.turnPlayerId as Player;
      const end = driver.action(owner, "end-turn");
      const before = PLAYERS.map(player => digest(driver.view(player)));
      driver.send(owner, { type: "end-turn", windowId: end.windowId }, "reject-stale-end",
        { expectedVersion: driver.view(owner).match.stateVersion - 1, reject: true });
      requireObserved(JSON.stringify(PLAYERS.map(player => digest(driver.view(player)))) === JSON.stringify(before),
        "Stale command changed projections");
      driver.endTurn();
    }
  }
];
