// =============================================================================
// save.ts — localStorage persistence. Tolerant: anything missing or corrupt in
// the stored blob falls back to the default, so a bad write can never brick the
// game for the player.
// =============================================================================
import { NO_OUTFIT, type Outfit, type Hat, type Jersey } from './elephant';
import { ITEMS, type ItemId, type SaveApi, type SaveData } from './types';

const KEY = 'slamtrunk.save.v1';
const STADIUM_COUNT = 5;

const HATS: Hat[] = ['crown', 'party'];
const JERSEYS: Jersey[] = ['red', 'purple', 'green'];
const ITEM_IDS: ItemId[] = ITEMS.map((i) => i.id);

function defaults(): SaveData {
  return { coins: 0, stadiumIndex: 0, loop: 0, owned: [], outfit: { ...NO_OUTFIT }, wins: 0, games: 0 };
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function bool(v: unknown): boolean {
  return v === true;
}

function mergeOutfit(v: unknown): Outfit {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const hat = HATS.includes(o.hat as Hat) ? (o.hat as Hat) : null;
  const jersey = JERSEYS.includes(o.jersey as Jersey) ? (o.jersey as Jersey) : null;
  return {
    hat, jersey,
    glasses: bool(o.glasses), sneakers: bool(o.sneakers), cape: bool(o.cape), bowtie: bool(o.bowtie),
  };
}

function merge(raw: unknown): SaveData {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const owned = Array.isArray(o.owned)
    ? (o.owned.filter((id): id is ItemId => ITEM_IDS.includes(id as ItemId)))
    : [];
  return {
    coins: int(o.coins, 0, 0, 1e6),
    stadiumIndex: int(o.stadiumIndex, 0, 0, STADIUM_COUNT - 1),
    loop: int(o.loop, 0, 0, 1e6),
    owned: [...new Set(owned)],
    outfit: mergeOutfit(o.outfit),
    wins: int(o.wins, 0, 0, 1e6),
    games: int(o.games, 0, 0, 1e6),
  };
}

export function createSave(): SaveApi {
  return {
    load(): SaveData {
      try {
        const txt = localStorage.getItem(KEY);
        if (!txt) return defaults();
        return merge(JSON.parse(txt));
      } catch {
        return defaults();
      }
    },
    save(d: SaveData): void {
      try {
        localStorage.setItem(KEY, JSON.stringify(merge(d)));
      } catch {
        /* private browsing / full quota — play on without saving */
      }
    },
    reset(): void {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
