// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, team scores,
// roster, kill feed, bomb status, channel bar, buy menu, round banner and the overlay
// panels. It never touches the simulation; main.js pushes numbers in and reads the
// play and buy callbacks out.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

const COPY = {
  start: {
    title: 'BREACHLINE',
    copy: 'VANGUARD attacks Site A. Plant the bomb, or eliminate HAVOC. First to 5 rounds takes the match. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'BREACHLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const weaponName = document.getElementById('weapon-name');
  const moneyValue = document.getElementById('money-value');
  const healthFill = document.getElementById('health-fill');
  const healthValue = document.getElementById('health-value');
  const armorChip = document.getElementById('armor-chip');
  const timerValue = document.getElementById('timer-value');
  const scoreV = document.getElementById('score-v');
  const scoreH = document.getElementById('score-h');
  const roundLabel = document.getElementById('round-label');
  const rosterV = document.getElementById('roster-v');
  const rosterH = document.getElementById('roster-h');
  const killfeed = document.getElementById('killfeed');
  const bombStatus = document.getElementById('bomb-status');
  const channel = document.getElementById('channel');
  const channelFill = document.getElementById('channel-fill');
  const channelLabel = document.getElementById('channel-label');
  const banner = document.getElementById('banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerSub = document.getElementById('banner-sub');
  const buyMenu = document.getElementById('buy-menu');
  const buyGrid = document.getElementById('buy-grid');
  const buyMoney = document.getElementById('buy-money');
  const buyClose = document.getElementById('buy-close');
  const crosshair = document.getElementById('crosshair');
  const hitmarker = document.getElementById('hitmarker');
  const hint = document.getElementById('hint');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let buyHandler = null;

  const SHOP = [
    { key: '1', def: WEAPONS.rifle },
    { key: '2', def: WEAPONS.marksman },
    { key: '3', def: GRENADE },
    { key: '4', def: ARMOR },
  ];
  for (const item of SHOP) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'buy-card';
    card.dataset.item = item.def.id;
    card.innerHTML = `<b>${item.def.name}</b><span>${item.def.blurb}</span><i>$${item.def.price}</i><kbd>${item.key}</kbd>`;
    card.addEventListener('click', () => {
      if (buyHandler) buyHandler(item.def.id);
    });
    buyGrid.appendChild(card);
  }
  buyClose.addEventListener('click', () => {
    buyMenu.hidden = true;
  });

  function rosterRow(name, alive, hp, team) {
    const row = document.createElement('div');
    row.className = `roster-row ${alive ? '' : 'dead'} ${team}`;
    row.innerHTML = `<span class="dot"></span><span class="rname">${name}</span><span class="rhp">${alive ? hp : '✕'}</span>`;
    return row;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      weaponName.textContent = name;
    },
    setMoney(value) {
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setHealth(hp, armor) {
      healthValue.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
      armorChip.hidden = !armor;
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      timerValue.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerValue.parentElement.classList.toggle('buy-phase', phase === 'buy');
    },
    setScore(v, h, round) {
      scoreV.textContent = String(v);
      scoreH.textContent = String(h);
      roundLabel.textContent = `ROUND ${round} / 9`;
    },
    setRoster(vanguard, havoc) {
      rosterV.replaceChildren(...vanguard.map((p) => rosterRow(p.name, p.alive, Math.ceil(p.hp), 'vanguard')));
      rosterH.replaceChildren(...havoc.map((p) => rosterRow(p.name, p.alive, Math.ceil(p.hp), 'havoc')));
    },
    addKill(killer, victim, weapon, headshot) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      row.innerHTML = `<span class="killer">${killer}</span> <span class="kweapon">${headshot ? '◎ ' : ''}${weapon}</span> <span class="victim">${victim}</span>`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    setBomb(text, urgent) {
      bombStatus.textContent = text;
      bombStatus.hidden = !text;
      bombStatus.classList.toggle('urgent', !!urgent);
    },
    setChannel(label, progress) {
      if (!label) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setHint(text) {
      hint.textContent = text;
      hint.hidden = !text;
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    showBanner(titleText, sub, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showBuy(open) {
      buyMenu.hidden = !open;
    },
    isBuyOpen() {
      return !buyMenu.hidden;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'matchEnd') copy.textContent = detail;
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
