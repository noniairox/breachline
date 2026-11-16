// The match: one state machine for rounds and the match. Buy phase (15 s, move in
// spawn, buy menu open), live round (100 s), round end (banner, money, 4 s), next
// round. First to 5 rounds wins the match (max 9). A round ends by elimination, by
// the bomb exploding (attackers win), by a defuse (defenders win), or by the clock
// running out (defenders win). Money: kill +300, plant +300, round win +3250,
// round loss +1900. All numbers are here; main.js only calls the transitions.
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;

export function createRounds() {
  const state = {
    phase: 'buy', // buy | live | end | matchEnd
    round: 1,
    timer: BUY_SECONDS,
    scoreVanguard: 0,
    scoreHavoc: 0,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    plants: 0,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
  };

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.roundWinner = null;
    state.roundReason = '';
  }

  function beginLive() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'matchEnd') return false;
    state.phase = 'end';
    state.timer = ROUND_END_SECONDS;
    state.roundWinner = winner;
    state.roundReason = reason;
    if (winner === 'vanguard') state.scoreVanguard += 1;
    else state.scoreHavoc += 1;
    state.money += winner === 'vanguard' ? WIN_REWARD : LOSS_REWARD;
    if (state.scoreVanguard >= ROUNDS_TO_WIN || state.scoreHavoc >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.scoreVanguard > state.scoreHavoc ? 'vanguard' : state.scoreHavoc > state.scoreVanguard ? 'havoc' : 'draw';
    }
    return true;
  }

  function nextRound() {
    if (state.matchWinner) {
      state.phase = 'matchEnd';
      return;
    }
    state.round += 1;
    startRound();
  }

  function resetMatch() {
    state.round = 1;
    state.scoreVanguard = 0;
    state.scoreHavoc = 0;
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    state.plants = 0;
    state.matchWinner = null;
    startRound();
  }

  function step(dt) {
    if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'end') {
      state.timer -= dt;
    }
  }

  return {
    state,
    startRound,
    beginLive,
    endRound,
    nextRound,
    resetMatch,
    step,
  };
}
