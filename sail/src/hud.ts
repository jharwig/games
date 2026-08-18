import type { Boat } from './boat';
import type { Course } from './course';
import type { Wind } from './wind';
import { formatTime, ordinal } from './util';

/** DOM HUD: speed, lap/pos/time, wind dial, trim gauge, minimap, messages. */
export class Hud {
  private root = document.getElementById('hud')!;
  private speedEl = document.getElementById('speed-val')!;
  private lapEl = document.getElementById('lap-val')!;
  private posEl = document.getElementById('pos-val')!;
  private timeEl = document.getElementById('time-val')!;
  private windArrow = document.getElementById('wind-arrow')!;
  private boatTick = document.getElementById('boat-tick')!;
  private windSpeedEl = document.getElementById('wind-speed-label')!;
  private trimFill = document.getElementById('trim-fill')!;
  private trimOpt = document.getElementById('trim-opt')!;
  private messageEl = document.getElementById('message')!;
  private toastEl = document.getElementById('toast')!;
  private spiChip = document.getElementById('spi-chip')!;
  private ocsBanner = document.getElementById('ocs-banner')!;
  private penaltyBanner = document.getElementById('penalty-banner')!;
  private mapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private mapCtx = this.mapCanvas.getContext('2d')!;
  private msgTimer: number | undefined;
  private toastTimer: number | undefined;

  private markPointer = document.getElementById('mark-pointer')!;
  private markDist = document.getElementById('mark-dist')!;
  private bubbles = new Map<number, { el: HTMLElement; until: number }>();

  setVisible(v: boolean): void {
    this.root.classList.toggle('visible', v);
  }

  /**
   * Orbiting arrow pointing at the next mark. `px,py` = player screen pos,
   * `dx,dy` = screen-space unit direction toward the mark, `dist` in meters.
   */
  updateMarkPointer(visible: boolean, px: number, py: number, dx: number, dy: number, dist: number): void {
    if (!visible) {
      this.markPointer.style.display = 'none';
      return;
    }
    this.markPointer.style.display = 'flex';
    const R = 96;
    const x = px + dx * R;
    const y = py + dy * R;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up-screen
    this.markPointer.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -55%)`;
    (this.markPointer.firstElementChild as HTMLElement).style.transform = `rotate(${angle.toFixed(1)}deg)`;
    this.markDist.textContent = `${Math.round(dist)}m`;
  }

  update(
    player: Boat,
    boats: Boat[],
    wind: Wind,
    raceTime: number,
    position: number,
    course: Course,
    screenYaw = 0, // camera yaw: world angle that maps to "up" on screen
  ): void {
    this.speedEl.textContent = Math.abs(player.speed * 1.15).toFixed(1);
    this.lapEl.textContent = player.finished ? 'DONE' : `LAP ${player.lap}/${course.totalLaps}`;
    this.posEl.textContent = ordinal(position);
    this.timeEl.textContent = raceTime < 0 ? `-${formatTime(-raceTime)}` : formatTime(raceTime);

    // spinnaker state chip
    if (player.spinDeploy > 0.02 || player.spinUp) {
      this.spiChip.style.display = 'block';
      this.spiChip.textContent = player.spinUp
        ? player.spinDeploy < 0.98
          ? 'SPI ▲ hoisting'
          : 'SPI ▲ flying'
        : 'SPI ▼ dousing';
    } else {
      this.spiChip.style.display = 'none';
    }

    // OCS + penalty banners
    this.ocsBanner.style.display = player.ocs ? 'block' : 'none';
    this.penaltyBanner.style.display = player.penalty > 0 ? 'block' : 'none';

    // wind dial: arrow shows where the wind blows TOWARD, in screen space.
    // screen-right = world -X here, so world angles appear mirrored (negated).
    const windDeg = (-(wind.direction - screenYaw) * 180) / Math.PI;
    this.windArrow.setAttribute('transform', `rotate(${windDeg.toFixed(1)})`);
    const headingDeg = (-(player.heading - screenYaw) * 180) / Math.PI;
    this.boatTick.setAttribute('transform', `rotate(${headingDeg.toFixed(1)}) translate(0, -32)`);
    this.windSpeedEl.textContent = `${(wind.speed * 1.94).toFixed(0)} KTS`;

    // trim gauge: fill = sheeted-in amount (bottom = eased)
    this.trimFill.style.height = `${((1 - player.trim) * 100).toFixed(1)}%`;
    this.trimOpt.style.bottom = `${((1 - player.optimalTrim) * 100).toFixed(1)}%`;
    this.trimOpt.style.opacity = player.luffing > 0.4 ? '1' : '0.85';

    this.drawMinimap(player, boats, course, wind);
  }

  /** comic hail ("STARBOARD!") anchored to a boat, keyed by boat index */
  say(id: number, text: string, now: number, holdSec = 2.2): void {
    let b = this.bubbles.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'speech-bubble';
      this.root.appendChild(el);
      b = { el, until: 0 };
      this.bubbles.set(id, b);
    }
    b.el.textContent = text;
    b.el.classList.remove('pop');
    void b.el.offsetWidth; // restart the pop animation
    b.el.classList.add('pop');
    b.until = now + holdSec;
  }

  /** reposition a bubble each frame (screen px, anchored above the boat) */
  positionBubble(id: number, x: number, y: number, now: number): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    if (now > b.until) {
      b.el.classList.remove('pop');
      return;
    }
    b.el.style.transform = `translate(${x.toFixed(0)}px, ${(y - 46).toFixed(0)}px) rotate(-4deg)`;
  }

  clearBubbles(): void {
    for (const b of this.bubbles.values()) b.el.classList.remove('pop');
  }

  showMessage(text: string, holdMs = 900): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.add('pop');
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.messageEl.classList.remove('pop'), holdMs);
  }

  toast(text: string, holdMs = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), holdMs);
  }

  private drawMinimap(player: Boat, boats: Boat[], course: Course, wind: Wind): void {
    const ctx = this.mapCtx;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;

    // world bounds; mirror x so the map matches the screen (screen-right = -X)
    const B = 150;
    const sx = (x: number) => ((B - x) / (2 * B)) * W;
    const sz = (z: number) => H - ((z + B) / (2 * B)) * H;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8, 40, 60, 0.9)';
    ctx.fillRect(0, 0, W, H);

    // islands
    ctx.fillStyle = '#c9b988';
    for (const isl of course.islands) {
      ctx.beginPath();
      ctx.arc(sx(isl.x), sz(isl.z), (isl.r / (2 * B)) * W, 0, Math.PI * 2);
      ctx.fill();
    }

    // gates
    for (let i = 0; i < course.gates.length; i++) {
      const g = course.gates[i]!;
      const isNext = i === player.nextGate && !player.finished;
      ctx.strokeStyle = isNext ? '#ffd12e' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = isNext ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(sx(g.a.x), sz(g.a.z));
      ctx.lineTo(sx(g.b.x), sz(g.b.z));
      ctx.stroke();
    }

    // boats
    for (const b of boats) {
      const isPlayer = b === player;
      ctx.save();
      ctx.translate(sx(b.pos.x), sz(b.pos.z));
      // map x is mirrored, so world rotations flip sign on the canvas
      ctx.rotate(-b.heading);
      ctx.fillStyle = isPlayer ? '#ffd12e' : `#${b.spec.color.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      const s = isPlayer ? 6 : 4.5;
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.62, s);
      ctx.lineTo(-s * 0.62, s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // wind arrow, top-right corner of the map
    ctx.save();
    ctx.translate(W - 15, 15);
    ctx.rotate(-wind.direction); // mirrored map: world rotations flip sign
    ctx.strokeStyle = '#bfe8ff';
    ctx.fillStyle = '#bfe8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(4, -3);
    ctx.lineTo(-4, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
