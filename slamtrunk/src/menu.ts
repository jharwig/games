// =============================================================================
// menu.ts — the title screen. main.ts owns the save data; this renders it and
// calls back. Listeners are attached once and read whatever handlers the most
// recent show() passed in.
// =============================================================================
import { STADIUM_NAME, STADIUM_ORDER } from './stadiums';
import { SHOP_UNLOCK_COINS, type MenuApi, type SaveData } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

type Handlers = { onPlay(): void; onShop(): void; onReset(): void };

/** name of the stadium the player is about to play */
export function stadiumNameFor(save: SaveData): string {
  const i = ((save.stadiumIndex % STADIUM_ORDER.length) + STADIUM_ORDER.length) % STADIUM_ORDER.length;
  return STADIUM_NAME[STADIUM_ORDER[i]];
}

const RESET_ARM_MS = 3000;

export function createMenu(): MenuApi {
  const menu = el('menu');
  const round = el('menu-round');
  const coins = el('menu-coins');
  const playBtn = el<HTMLButtonElement>('play-btn');
  const shopBtn = el<HTMLButtonElement>('menu-shop-btn');
  const resetBtn = el<HTMLButtonElement>('reset-btn');

  let handlers: Handlers | null = null;
  let resetTimer = 0;

  function disarmReset(): void {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = 0;
    resetBtn.classList.remove('armed');
    resetBtn.textContent = 'Reset progress';
  }

  playBtn.addEventListener('click', () => { disarmReset(); handlers?.onPlay(); });
  shopBtn.addEventListener('click', () => { disarmReset(); handlers?.onShop(); });
  resetBtn.addEventListener('click', () => {
    if (resetTimer) {           // second tap inside the window — really reset
      disarmReset();
      handlers?.onReset();
      return;
    }
    resetBtn.classList.add('armed');
    resetBtn.textContent = 'Tap again to reset';
    resetTimer = window.setTimeout(disarmReset, RESET_ARM_MS);
  });

  return {
    show(save: SaveData, h: Handlers): void {
      handlers = h;
      disarmReset();

      coins.textContent = String(save.coins);

      playBtn.textContent = '';
      playBtn.append('Play');
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = stadiumNameFor(save);
      playBtn.append(sub);

      round.hidden = save.loop <= 0;
      round.textContent = `Round ${save.loop + 1}`;

      const unlocked = save.coins >= SHOP_UNLOCK_COINS || save.owned.length > 0;
      shopBtn.disabled = !unlocked;
      shopBtn.textContent = unlocked ? '🥜 Shop' : `🔒 ${SHOP_UNLOCK_COINS} coins to unlock`;

      menu.hidden = false;
    },
    hide(): void {
      disarmReset();
      menu.hidden = true;
    },
  };
}
