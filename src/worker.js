// ===== Constants =====
const PHASES = {
  LOBBY: "lobby",
  REVEAL: "reveal",
};
// 28枚デッキ (8-A) で「場5 + 手札2/人」なので物理的には (28-5)/2 = 11人まで。
// 飲み会向け UX (ショウダウン画面の見やすさ・1卓の盛り上がり) を考えて 8人で
// 打ち切る。9人目以降は WebSocket close code 4030 で弾く。
const MAX_PLAYERS = 8;
const GRACE_MS = 15_000;          // hold a seat through disconnect/reconnect
const TIEBREAKER_DELAY_MS = 4_000; // savor the showdown before a tiebreaker re-deal
const MAX_TIEBREAKER_ROUNDS = 6;   // safety net against pathological infinite ties

// REVEAL phase substages — host taps "めくる" to advance each one.
const STAGES = {
  DEAL: "deal",         // hole dealt, board empty (waiting for FLOP tap)
  FLOP: "flop",         // 3 community cards visible
  TURN: "turn",         // 4 community cards visible
  RIVER: "river",       // 5 community cards visible
  SHOWDOWN: "showdown", // 5 visible + everyone's hole + best-hand + loser
};

const SUITS = [
  { sym: "♠", color: "black" },
  { sym: "♥", color: "red" },
  { sym: "♦", color: "red" },
  { sym: "♣", color: "black" },
];
// 28-card short deck — 8 through A only (7 ranks × 4 suits).
// 役強度は標準ホールデム順 (Royal > SF > 4K > FH > F > S > 3K > 2P > P > HC) のまま。
// デッキが薄いので強い役が出やすく、1局の決着が速い。
const RANKS = [
  { v: 8, label: "8" }, { v: 9, label: "9" }, { v: 10, label: "10" },
  { v: 11, label: "J" }, { v: 12, label: "Q" }, { v: 13, label: "K" },
  { v: 14, label: "A" },
];

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ ...r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ===== Standard Texas Hold'em hand evaluator (5-card; best of 7) =====
const TIER_NAMES = [
  "ハイカード", "ワンペア", "ツーペア", "スリーカード",
  "ストレート", "フラッシュ", "フルハウス", "フォーカード",
  "ストレートフラッシュ", "ロイヤルフラッシュ",
];

function evaluate5(hand) {
  const ranks = hand.map(c => c.v).sort((a, b) => b - a);
  const suitsArr = hand.map(c => c.suit.sym);
  const flush = suitsArr.every(s => s === suitsArr[0]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const sortedCounts = Object.entries(counts)
    .map(([k, v]) => ({ rank: +k, count: v }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const countVals = sortedCounts.map(c => c.count);

  // 28-card deck では A は high のみ。A-8-9-10-J を wheel として扱わない
  // (= A と 8 は繋がない) ので、可能なストレートは 4 種類:
  //   8-9-10-J-Q / 9-10-J-Q-K / 10-J-Q-K-A の3つ + Royal用 10-J-Q-K-A
  let isStraight = false;
  let straightTop = 0;
  if (countVals[0] === 1 && ranks[0] - ranks[4] === 4) {
    isStraight = true;
    straightTop = ranks[0];
  }

  let tier;
  let primary = [];
  if (flush && isStraight) {
    tier = (straightTop === 14) ? 9 : 8;
    primary = [straightTop];
  } else if (countVals[0] === 4) {
    tier = 7;
    primary = [sortedCounts[0].rank, sortedCounts[1].rank];
  } else if (countVals[0] === 3 && countVals[1] === 2) {
    tier = 6;
    primary = [sortedCounts[0].rank, sortedCounts[1].rank];
  } else if (flush) {
    tier = 5;
    primary = ranks;
  } else if (isStraight) {
    tier = 4;
    primary = [straightTop];
  } else if (countVals[0] === 3) {
    tier = 3;
    primary = [sortedCounts[0].rank, sortedCounts[1].rank, sortedCounts[2].rank];
  } else if (countVals[0] === 2 && countVals[1] === 2) {
    tier = 2;
    primary = [sortedCounts[0].rank, sortedCounts[1].rank, sortedCounts[2].rank];
  } else if (countVals[0] === 2) {
    tier = 1;
    primary = sortedCounts.map(c => c.rank);
  } else {
    tier = 0;
    primary = ranks;
  }
  return { tier, primary, name: TIER_NAMES[tier] };
}

function compareHands(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  for (let i = 0; i < Math.max(a.primary.length, b.primary.length); i++) {
    const av = a.primary[i] || 0;
    const bv = b.primary[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations(arr, k) {
  const result = [];
  const n = arr.length;
  if (k > n || k < 0) return result;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    result.push(indices.map(i => arr[i]));
    let i = k - 1;
    while (i >= 0 && indices[i] === n - k + i) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
  return result;
}

function bestHand(cards) {
  let best = null;
  let bestCombo = null;
  for (const combo of combinations(cards, 5)) {
    const ev = evaluate5(combo);
    if (!best || compareHands(ev, best) > 0) {
      best = ev;
      bestCombo = combo;
    }
  }
  return { ...best, cards: bestCombo };
}

// ===== Worker entry =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{4,6}$/.test(room)) {
        return new Response("Invalid room code", { status: 400 });
      }
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

// ===== GameRoom Durable Object =====
export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map();     // sessionId -> { ws, playerId }
    this.players = new Map();      // playerId -> { name, hole, drinkCount, removeTimer }
    this.community = [];
    this.phase = PHASES.LOBBY;
    this.hostId = null;
    this.timer = null;
    this.lastResult = null;
    this.eligibleIds = [];         // who holds cards in the current round
    this.roundNumber = 0;          // 1 = original showdown, 2+ = tiebreakers
    this.tiebreakerScheduled = false;
    this.stage = null;             // STAGES.* while in REVEAL, null in LOBBY
    this._fullCommunity = [];      // all 5 community cards (server-private until staged)
  }

  async fetch(request) {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "").trim().slice(0, 20);
    const clientId = (url.searchParams.get("clientId") || "").trim();
    if (!name) return new Response("Missing name", { status: 400 });
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
      return new Response("Missing or invalid clientId", { status: 400 });
    }

    const existing = this.players.get(clientId);

    let rejectCode = 0;
    let rejectReason = "";
    if (!existing) {
      if (this.players.size >= MAX_PLAYERS && this.phase === PHASES.LOBBY) {
        rejectCode = 4030; rejectReason = "Room full";
      } else if (this.phase !== PHASES.LOBBY) {
        rejectCode = 4023; rejectReason = "Game in progress";
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (rejectCode) {
      try { server.close(rejectCode, rejectReason); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    }

    if (existing) {
      if (existing.removeTimer) {
        clearTimeout(existing.removeTimer);
        existing.removeTimer = null;
      }
      existing.name = name;
    } else {
      this.players.set(clientId, {
        name,
        hole: null,
        drinkCount: 0,
        removeTimer: null,
      });
      if (!this.hostId) this.hostId = clientId;
    }

    const prior = existing ? this.sessions.get(clientId) : null;
    this.sessions.set(clientId, { ws: server, playerId: clientId });

    server.addEventListener("message", async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      await this.handleMessage(clientId, msg);
    });
    const onClose = () => {
      const sess = this.sessions.get(clientId);
      if (sess && sess.ws === server) {
        this.handleDisconnect(clientId);
      }
    };
    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    if (prior) {
      try { prior.ws.close(4002, "Replaced by new connection"); } catch {}
    }

    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(playerId, msg) {
    switch (msg.type) {
      case "ping": {
        const sess = this.sessions.get(playerId);
        if (sess) {
          try { sess.ws.send(JSON.stringify({ type: "pong" })); } catch {}
        }
        break;
      }
      case "start":
        if (playerId === this.hostId && this.phase === PHASES.LOBBY) {
          if (this.players.size < 2) return;
          this.startShowdown([...this.players.keys()]);
        }
        break;
      case "advance":
        // Host taps to flip the next stage: DEAL → FLOP → TURN → RIVER → SHOWDOWN.
        // The SHOWDOWN itself triggers _resolveShowdown which decides drinks /
        // tiebreaker. Spectators / non-hosts can't advance.
        if (playerId === this.hostId
            && this.phase === PHASES.REVEAL
            && (this.stage === STAGES.DEAL
                || this.stage === STAGES.FLOP
                || this.stage === STAGES.TURN
                || this.stage === STAGES.RIVER)) {
          this._advanceStage();
        }
        break;
      case "next":
        // Only the host can advance, and only at the final showdown with no
        // tiebreaker still pending.
        if (playerId === this.hostId
            && this.phase === PHASES.REVEAL
            && this.stage === STAGES.SHOWDOWN
            && !this.tiebreakerScheduled) {
          this.resetToLobby();
        }
        break;
    }
  }

  handleDisconnect(playerId) {
    this.sessions.delete(playerId);
    const player = this.players.get(playerId);
    if (!player) return;

    if (this.phase === PHASES.LOBBY) {
      this.removePlayer(playerId);
      this.broadcast();
      return;
    }

    // Active round: hold seat for grace period (preserves cards + drinkCount).
    if (player.removeTimer) clearTimeout(player.removeTimer);
    player.removeTimer = setTimeout(() => {
      player.removeTimer = null;
      this.removePlayer(playerId);
      if (this.players.size === 0) {
        this.clearTimer();
        this.resetToLobby();
        return;
      }
      // If the leaver was in eligibleIds, recompute / advance the round.
      if (this.phase === PHASES.REVEAL && this.eligibleIds.includes(playerId)) {
        this.eligibleIds = this.eligibleIds.filter(id => id !== playerId);
        // If only one (or zero) eligible left and we were waiting for a tiebreaker
        // re-deal, just collapse to lobby.
        if (this.eligibleIds.length < 2) {
          this.clearTimer();
          this.tiebreakerScheduled = false;
          // No legitimate single-loser result possible — let the host re-start.
          this.broadcast();
          return;
        }
      }
      if (this.players.size < 2 && this.phase !== PHASES.LOBBY) {
        this.resetToLobby();
        return;
      }
      this.broadcast();
    }, GRACE_MS);
    this.broadcast();
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.hostId === playerId) {
      this.hostId = this.players.keys().next().value || null;
    }
  }

  // ===== Round flow =====
  startShowdown(eligibleIds) {
    this.phase = PHASES.REVEAL;
    this.eligibleIds = eligibleIds;
    this.roundNumber = 1;
    this.tiebreakerScheduled = false;
    this.dealAndCompute();
  }

  startTiebreaker(eligibleIds) {
    if (eligibleIds.length < 2) {
      // shouldn't happen, but bail to lobby safely
      this.resetToLobby();
      return;
    }
    this.eligibleIds = eligibleIds;
    this.roundNumber += 1;
    this.tiebreakerScheduled = false;
    this.dealAndCompute();
  }

  // Round entry: deal hole cards but leave the board face-down. The host
  // taps "FLOP" to flip the first 3, then TURN / RIVER / SHOWDOWN one by one.
  // Tiebreaker re-deal is still server-driven (auto-fires after
  // TIEBREAKER_DELAY_MS once a tie is locked in at SHOWDOWN).
  dealAndCompute() {
    const deck = buildDeck();
    for (const [id, p] of this.players) {
      p.hole = this.eligibleIds.includes(id) ? [deck.pop(), deck.pop()] : null;
    }
    this._fullCommunity = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

    this.lastResult = null;
    this.stage = STAGES.DEAL;
    this.community = [];                 // empty until host taps FLOP
    this.clearTimer();
    this.broadcast();
  }

  _advanceStage() {
    if (this.stage === STAGES.DEAL) {
      this.stage = STAGES.FLOP;
      this.community = this._fullCommunity.slice(0, 3);
      this.broadcast();
    } else if (this.stage === STAGES.FLOP) {
      this.stage = STAGES.TURN;
      this.community = this._fullCommunity.slice(0, 4);
      this.broadcast();
    } else if (this.stage === STAGES.TURN) {
      this.stage = STAGES.RIVER;
      this.community = this._fullCommunity.slice(0, 5);
      this.broadcast();
    } else if (this.stage === STAGES.RIVER) {
      this.stage = STAGES.SHOWDOWN;
      this._resolveShowdown();
    }
  }

  // Final step: best-hand evaluation, loser detection, tiebreaker scheduling.
  _resolveShowdown() {
    const handsById = {};
    for (const id of this.eligibleIds) {
      const p = this.players.get(id);
      if (!p || !p.hole) continue;
      handsById[id] = bestHand([...p.hole, ...this.community]);
    }
    const presentIds = Object.keys(handsById);

    let losers = [];
    const drinks = {};
    if (presentIds.length > 0) {
      let worstRef = handsById[presentIds[0]];
      for (const id of presentIds) {
        if (compareHands(handsById[id], worstRef) < 0) worstRef = handsById[id];
      }
      losers = presentIds.filter(id => compareHands(handsById[id], worstRef) === 0);
    }

    let final = false;
    if (losers.length === 1) {
      drinks[losers[0]] = 1;
      this.players.get(losers[0]).drinkCount += 1;
      this.tiebreakerScheduled = false;
      final = true;
    } else if (losers.length >= 2 && this.roundNumber >= MAX_TIEBREAKER_ROUNDS) {
      // safety net — endless tie. Everyone tied drinks 1.
      for (const id of losers) {
        drinks[id] = 1;
        this.players.get(id).drinkCount += 1;
      }
      this.tiebreakerScheduled = false;
      final = true;
    } else if (losers.length >= 2) {
      this.tiebreakerScheduled = true;
      this.clearTimer();
      const tiedIds = [...losers];
      this.timer = setTimeout(() => {
        this.timer = null;
        this.startTiebreaker(tiedIds);
      }, TIEBREAKER_DELAY_MS);
    } else {
      // No eligible players left (everyone disconnected mid-round).
      this.tiebreakerScheduled = false;
      final = true;
    }

    this.lastResult = {
      community: this.community,
      hands: Object.fromEntries(
        this.eligibleIds
          .filter(id => this.players.has(id) && this.players.get(id).hole)
          .map(id => [id, this.players.get(id).hole])
      ),
      bestHands: Object.fromEntries(
        Object.entries(handsById).map(([id, h]) => [id, {
          tier: h.tier, name: h.name, cards: h.cards,
        }])
      ),
      eligibleIds: [...this.eligibleIds],
      losers,
      drinks,
      isTiebreaker: this.roundNumber > 1,
      roundNumber: this.roundNumber,
      tiebreakerScheduled: this.tiebreakerScheduled,
      final,
    };
    this.broadcast();
  }

  resetToLobby() {
    this.phase = PHASES.LOBBY;
    this.clearTimer();
    this.community = [];
    this._fullCommunity = [];
    this.eligibleIds = [];
    this.roundNumber = 0;
    this.stage = null;
    this.tiebreakerScheduled = false;
    for (const p of this.players.values()) p.hole = null;
    this.lastResult = null;
    this.broadcast();
  }

  clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  broadcast() {
    for (const [, session] of this.sessions) {
      try {
        const msg = this.viewForPlayer(session.playerId);
        session.ws.send(JSON.stringify(msg));
      } catch {
        // ignore broken sockets
      }
    }
  }

  viewForPlayer(playerId) {
    const me = this.players.get(playerId);
    const isShowdown = this.stage === STAGES.SHOWDOWN;
    const players = [...this.players.entries()].map(([id, p]) => {
      const isYou = id === playerId;
      // Hole-card visibility:
      //   - to yourself: always while you're eligible during REVEAL
      //   - to others: only at SHOWDOWN
      //   - to spectators (eliminated this tiebreaker round): never
      let hole = null;
      if (this.phase === PHASES.REVEAL && this.eligibleIds.includes(id)) {
        if (isYou || isShowdown) hole = p.hole;
      }
      return {
        id,
        name: p.name,
        drinkCount: p.drinkCount,
        hole,
        isYou,
        eligible: this.eligibleIds.includes(id),
      };
    });
    return {
      type: "state",
      state: {
        phase: this.phase,
        players,
        hostId: this.hostId,
        you: playerId,
        community: this.phase === PHASES.REVEAL ? this.community : [],
        myHole: (this.phase === PHASES.REVEAL && me) ? me.hole : null,
        // Result only revealed at showdown — earlier stages are pre-result.
        result: isShowdown ? this.lastResult : null,
        eligibleIds: [...this.eligibleIds],
        roundNumber: this.roundNumber,
        isTiebreaker: this.roundNumber > 1,
        tiebreakerScheduled: this.tiebreakerScheduled,
        stage: this.stage,
      },
    };
  }
}
