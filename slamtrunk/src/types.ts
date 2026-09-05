// =============================================================================
// the shared contract every module codes against. Change it deliberately;
// game.ts / main.ts / hud.ts / menu.ts / shop.ts / save.ts / audio.ts / input.ts
// all import from here.
// =============================================================================
import type { Outfit } from './elephant';
import type { StadiumId } from './stadiums';
export type { Outfit, Hat, Jersey } from './elephant';
export type { StadiumId } from './stadiums';

export const GAME_SECONDS = 60;
export const ITEM_COST = 5;
export const SHOP_UNLOCK_COINS = 5;

export type Who = 'peanut' | 'ellie';

// ------------------------------------------------------------------ shop ----
export type ItemId = 'crown' | 'party' | 'glasses' | 'red' | 'purple' | 'green' | 'sneakers' | 'cape' | 'bowtie';
export interface ItemDef { id: ItemId; label: string; emoji: string; kind: keyof Outfit; value: Outfit[keyof Outfit] }
export const ITEMS: ItemDef[] = [
  { id: 'crown', label: 'Crown', emoji: '👑', kind: 'hat', value: 'crown' },
  { id: 'party', label: 'Party Hat', emoji: '🥳', kind: 'hat', value: 'party' },
  { id: 'glasses', label: 'Sunglasses', emoji: '🕶️', kind: 'glasses', value: true },
  { id: 'red', label: 'Red Jersey', emoji: '🔴', kind: 'jersey', value: 'red' },
  { id: 'purple', label: 'Purple Jersey', emoji: '🟣', kind: 'jersey', value: 'purple' },
  { id: 'green', label: 'Green Jersey', emoji: '🟢', kind: 'jersey', value: 'green' },
  { id: 'sneakers', label: 'Sneakers', emoji: '👟', kind: 'sneakers', value: true },
  { id: 'cape', label: 'Cape', emoji: '🦸', kind: 'cape', value: true },
  { id: 'bowtie', label: 'Bow Tie', emoji: '🎀', kind: 'bowtie', value: true },
];

// ------------------------------------------------------------------ save ----
export interface SaveData {
  coins: number;
  /** index into STADIUM_ORDER for the next game to play */
  stadiumIndex: number;
  /** how many times the player has gone around all five stadiums (0 = first time). Ellie gets harder each loop. */
  loop: number;
  owned: ItemId[];
  outfit: Outfit;
  wins: number;
  games: number;
}
export interface SaveApi {
  load(): SaveData;
  save(d: SaveData): void;
  reset(): void;
}

// ----------------------------------------------------------------- input ----
/** Drag anywhere = aim (dx/dy are the drag delta normalized to the shorter screen edge, -1..1-ish, y up is positive).
 *  Releasing a drag = shoot. A short tap without dragging = jump/block. */
export interface InputState {
  aiming: boolean;
  aimDx: number;
  aimDy: number;
  /** set on the frame a drag ends; consumed by the game */
  release: { dx: number; dy: number } | null;
  /** set on the frame a tap happens; consumed by the game */
  tap: boolean;
}

// ------------------------------------------------------------------ game ----
export interface Score { peanut: number; ellie: number }
export interface GameResult extends Score { won: boolean; stadium: StadiumId; loop: number }
export interface GameEvents {
  onCountdown(n: number | 'GO'): void;
  onTick(secondsLeft: number): void;
  onScore(who: Who, score: Score, threePointer: boolean): void;
  onShoot(who: Who): void;
  onBlock(who: Who): void;
  onBounce(): void;
  onMiss(who: Who): void;
  /** possession changed: tell the player what to do (aim & shoot vs tap to block) */
  onPossession(who: Who): void;
  onEnd(result: GameResult): void;
}

// -------------------------------------------------------------------- ui ----
export interface HudApi {
  show(): void;
  hide(): void;
  setScore(s: Score): void;
  setTime(secondsLeft: number): void;
  setCoins(n: number): void;
  setStadium(name: string): void;
  showCountdown(n: number | 'GO'): void;
  /** brief centred flash, e.g. "SWISH! +2", "BLOCKED!", "+1 coin" */
  flash(text: string, kind?: 'good' | 'bad' | 'neutral'): void;
  /** persistent hint at the bottom: "drag to aim · let go to shoot" or "tap to jump and block!" */
  setHint(text: string): void;
}
export interface MenuApi {
  show(save: SaveData, handlers: { onPlay(): void; onShop(): void; onReset(): void }): void;
  hide(): void;
}
export interface ResultApi {
  show(result: GameResult, coinsNow: number, nextStadiumName: string, handlers: { onNext(): void; onShop(): void; onMenu(): void }): void;
  hide(): void;
}
export interface ShopApi {
  show(save: SaveData, handlers: { onBuy(id: ItemId): void; onToggleWear(id: ItemId): void; onClose(): void }): void;
  /** re-render after a buy / wear change */
  refresh(save: SaveData): void;
  hide(): void;
}

// ----------------------------------------------------------------- audio ----
export interface Sfx {
  /** must be called from a user gesture before anything plays */
  unlock(): void;
  swish(): void;
  bounce(): void;
  rim(): void;
  trumpet(who: Who): void;
  cheer(): void;
  groan(): void;
  buzzer(): void;
  whistle(): void;
  block(): void;
  coin(): void;
  /** countdown tick / GO */
  tick(final: boolean): void;
  /** crowd murmur loop; level 0..1 */
  setCrowd(level: number): void;
  setMuted(m: boolean): void;
  muted(): boolean;
}
