// =============================================================================
// wiring: renderer + input + game + the DOM overlays + sound.
// menu -> game -> result -> (next game | shop | menu)
// =============================================================================
import * as THREE from 'three';
import { createInput } from './input';
import { Game } from './game';
import { createHud } from './hud';
import { createMenu } from './menu';
import { createResult } from './result';
import { createShop } from './shop';
import { createSave } from './save';
import { createSfx } from './audio';
import { STADIUM_NAME, STADIUM_ORDER } from './stadiums';
import { ITEMS, SHOP_UNLOCK_COINS, ITEM_COST, type GameEvents, type GameResult, type ItemId, type SaveData } from './types';

// ------------------------------------------------------------- renderer ----
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // phones: never more than 2
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x05070c, 1);
renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
app.appendChild(renderer.domElement);

// --------------------------------------------------------------- modules ----
const save = createSave();
const hud = createHud();
const menu = createMenu();
const result = createResult();
const shop = createShop();
const sfx = createSfx();
const input = createInput(renderer.domElement);

let data: SaveData = save.load();
const persist = (): void => save.save(data);

// audio can only start from a gesture
let unlocked = false;
addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; sfx.unlock(); } }, { capture: true });

type State = 'menu' | 'game' | 'result' | 'shop';
let state: State = 'menu';
/** where the shop was opened from, so closing it goes back there */
let shopFrom: State = 'menu';
let lastResult: GameResult | null = null;
let endAt = 0;   // timestamp for the buzzer -> result-screen delay

const stadiumOf = (i: number) => STADIUM_ORDER[((i % STADIUM_ORDER.length) + STADIUM_ORDER.length) % STADIUM_ORDER.length];
const shopUnlocked = (): boolean => data.coins >= SHOP_UNLOCK_COINS || data.owned.length > 0;

// ----------------------------------------------------------------- events ----
const events: GameEvents = {
  onCountdown(n) {
    hud.showCountdown(n);
    sfx.tick(n === 'GO');
  },
  onTick(s) {
    hud.setTime(s);
    if (s <= 5 && s > 0) sfx.tick(false);
  },
  onScore(who, score, three) {
    hud.setScore(score);
    sfx.swish();
    sfx.trumpet(who);
    if (who === 'peanut') {
      hud.flash(three ? `SWISH! +3 🥜` : `SWISH! +2`, 'good');
      sfx.cheer();
    } else {
      hud.flash(three ? 'Ellie scores +3' : 'Ellie scores +2', 'bad');
      sfx.groan();
    }
  },
  onShoot() { /* the whoosh is covered by the swish / rim sounds */ },
  onBlock(who) {
    sfx.block();
    if (who === 'peanut') { hud.flash('BLOCKED IT! 🐘', 'good'); sfx.cheer(); sfx.trumpet('peanut'); }
    else { hud.flash('Blocked by Ellie!', 'bad'); sfx.groan(); }
  },
  onBounce() {
    if (game.lastBounceWasRim) sfx.rim(); else sfx.bounce();
  },
  onMiss(who) {
    if (who === 'peanut') hud.flash('Missed!', 'bad');
  },
  onPossession(who) {
    sfx.whistle();
    hud.setHint(who === 'peanut' ? 'drag to aim · let go to shoot' : 'tap to jump and block!');
  },
  onEnd(r) {
    lastResult = r;
    sfx.buzzer();
    sfx.setCrowd(r.won ? 0.9 : 0.25);
    hud.flash(r.won ? 'YOU WIN! 🎉' : r.peanut === r.ellie ? 'A TIE — so close!' : 'Ellie wins…', r.won ? 'good' : 'bad');
    endAt = performance.now() + 1500;
    state = 'result';
  },
};

const game = new Game(renderer, events);

// ------------------------------------------------------------------ flow ----
function showMenu(): void {
  state = 'menu';
  hud.hide(); result.hide(); shop.hide();
  sfx.setCrowd(0.12);
  menu.show(data, {
    onPlay: () => startGame(),
    onShop: () => { if (shopUnlocked()) openShop('menu'); },
    // menu.ts asks for the confirming second tap; by the time it calls us the
    // player has confirmed
    onReset: () => { save.reset(); data = save.load(); showMenu(); },
  });
}

function openShop(from: State): void {
  shopFrom = from;
  state = 'shop';
  menu.hide(); result.hide();
  shop.show(data, {
    onBuy: (id: ItemId) => {
      if (data.owned.includes(id) || data.coins < ITEM_COST) return;
      data.coins -= ITEM_COST;
      data.owned.push(id);
      wear(id, true);
      persist(); sfx.coin(); shop.refresh(data);
    },
    onToggleWear: (id: ItemId) => {
      if (!data.owned.includes(id)) return;
      const item = ITEMS.find((i) => i.id === id)!;
      const on = data.outfit[item.kind] === item.value;
      wear(id, !on);
      persist(); shop.refresh(data);
    },
    onClose: () => { shop.hide(); if (shopFrom === 'result' && lastResult) showResult(); else showMenu(); },
  });
}

/** one piece per kind can be worn, so wearing a hat takes the other hat off */
function wear(id: ItemId, on: boolean): void {
  const item = ITEMS.find((i) => i.id === id)!;
  const kind = item.kind;
  if (typeof item.value === 'boolean') (data.outfit[kind] as boolean) = on;
  else (data.outfit[kind] as unknown) = on ? item.value : null;
}

function startGame(): void {
  state = 'game';
  menu.hide(); result.hide(); shop.hide();
  data.games++; persist();
  hud.show();
  hud.setScore({ peanut: 0, ellie: 0 });
  hud.setTime(60);
  hud.setCoins(data.coins);
  hud.setStadium(STADIUM_NAME[stadiumOf(data.stadiumIndex)]);
  hud.setHint('drag to aim · let go to shoot');
  sfx.setCrowd(0.35);
  game.start({ stadium: stadiumOf(data.stadiumIndex), loop: data.loop, outfit: data.outfit });
  game.resize();
}

/** apply the win/loss to the save, then show the result screen */
let awarded = false;
function awardAndShow(r: GameResult): void {
  if (!awarded) {
    awarded = true;
    if (r.won) {
      data.coins++; data.wins++;
      data.stadiumIndex++;
      if (data.stadiumIndex >= STADIUM_ORDER.length) { data.stadiumIndex = 0; data.loop++; }
      sfx.coin();
    }
    persist();
  }
  showResult();
}

function showResult(): void {
  const r = lastResult!;
  state = 'result';
  hud.hide(); menu.hide(); shop.hide();
  result.show(r, data.coins, STADIUM_NAME[stadiumOf(data.stadiumIndex)], {
    onNext: () => { awarded = false; startGame(); },
    onShop: () => openShop('result'),
    onMenu: () => { awarded = false; showMenu(); },
  });
}

// ------------------------------------------------------------------ loop ----
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 20, (now - last) / 1000);
  last = now;

  if (state === 'game') {
    game.update(dt, input.state);
    input.consume();
  } else {
    input.consume();
    // hold the buzzer moment on screen, then swap to the result card
    if (state === 'result' && lastResult && !awarded && now >= endAt) awardAndShow(lastResult);
    // keep the scene animating gently behind the overlays
    if (lastResult || state !== 'menu') game.update(dt, { aiming: false, aimDx: 0, aimDy: 0, release: null, tap: false });
  }
  game.render();
}

addEventListener('resize', () => game.resize());
game.resize();
showMenu();
requestAnimationFrame(frame);
