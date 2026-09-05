// =============================================================================
// shop.ts — the peanut shop. Renders the nine items straight from ITEMS and
// reports taps; main.ts spends the coins, enforces one-hat/one-jersey and calls
// refresh() with the updated save.
// =============================================================================
import { ITEM_COST, ITEMS, type ItemDef, type ItemId, type SaveData, type ShopApi } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

type Handlers = { onBuy(id: ItemId): void; onToggleWear(id: ItemId): void; onClose(): void };

interface Tile { root: HTMLDivElement; act: HTMLButtonElement }

function isWorn(save: SaveData, item: ItemDef): boolean {
  return save.outfit[item.kind] === item.value;
}

export function createShop(): ShopApi {
  const sheet = el('shop');
  const coinsEl = el('shop-coins');
  const grid = el('shop-grid');
  const closeBtn = el<HTMLButtonElement>('shop-close-btn');

  let handlers: Handlers | null = null;
  closeBtn.addEventListener('click', () => handlers?.onClose());

  // build the nine tiles once; refresh() only rewrites their state
  const tiles = new Map<ItemId, Tile>();
  for (const item of ITEMS) {
    const root = document.createElement('div');
    root.className = 'tile';

    const emo = document.createElement('div');
    emo.className = 'emo';
    emo.textContent = item.emoji;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = item.label;

    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'act';
    act.addEventListener('click', () => {
      const owned = act.dataset.owned === '1';
      if (owned) handlers?.onToggleWear(item.id);
      else handlers?.onBuy(item.id);
    });

    root.append(emo, label, act);
    grid.append(root);
    tiles.set(item.id, { root, act });
  }

  function render(save: SaveData): void {
    coinsEl.textContent = String(save.coins);
    for (const item of ITEMS) {
      const tile = tiles.get(item.id);
      if (!tile) continue;
      const owned = save.owned.includes(item.id);
      const worn = owned && isWorn(save, item);

      tile.root.classList.toggle('worn', worn);
      tile.act.dataset.owned = owned ? '1' : '0';
      tile.act.classList.toggle('wear', owned);
      tile.act.disabled = !owned && save.coins < ITEM_COST;
      tile.act.textContent = owned ? (worn ? 'WEARING ✓' : 'WEAR') : `🪙 ${ITEM_COST}`;
    }
  }

  return {
    show(save: SaveData, h: Handlers): void {
      handlers = h;
      render(save);
      sheet.hidden = false;
      sheet.scrollTop = 0;
    },
    refresh(save: SaveData): void {
      render(save);
    },
    hide(): void {
      sheet.hidden = true;
    },
  };
}
