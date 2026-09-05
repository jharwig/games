// =============================================================================
// result.ts — the end-of-game overlay. `nextStadiumName` is whatever main.ts
// decided comes next: the following stadium after a win, the same one after a
// loss.
// =============================================================================
import { SHOP_UNLOCK_COINS, type GameResult, type ResultApi } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

type Handlers = { onNext(): void; onShop(): void; onMenu(): void };

export function createResult(): ResultApi {
  const sheet = el('result');
  const title = el('result-title');
  const finalP = el('final-p');
  const finalE = el('final-e');
  const coinLine = el('result-coin');
  const nextLine = el('result-next');
  const nextBtn = el<HTMLButtonElement>('result-next-btn');
  const shopBtn = el<HTMLButtonElement>('result-shop-btn');
  const menuBtn = el<HTMLButtonElement>('result-menu-btn');

  let handlers: Handlers | null = null;
  nextBtn.addEventListener('click', () => handlers?.onNext());
  shopBtn.addEventListener('click', () => handlers?.onShop());
  menuBtn.addEventListener('click', () => handlers?.onMenu());

  return {
    show(result: GameResult, coinsNow: number, nextStadiumName: string, h: Handlers): void {
      handlers = h;

      title.textContent = result.won ? 'You win! 🏆' : 'Ellie wins this one';
      title.classList.toggle('win', result.won);
      title.classList.toggle('lose', !result.won);

      finalP.textContent = String(result.peanut);
      finalE.textContent = String(result.ellie);

      coinLine.hidden = !result.won;
      nextLine.textContent = result.won
        ? `Next stop: ${nextStadiumName}`
        : `Try the ${nextStadiumName} again!`;

      nextBtn.textContent = result.won ? 'Next' : 'Play again';
      shopBtn.hidden = coinsNow < SHOP_UNLOCK_COINS;

      sheet.hidden = false;
    },
    hide(): void {
      sheet.hidden = true;
    },
  };
}
