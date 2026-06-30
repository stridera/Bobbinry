/**
 * Canvas rendering for Bookworm Siege.
 *
 * Simple vector art (no sprites): a winding path that resolves to a centred
 * castle, segmented bookworms, stone turrets, and projectiles that carry the
 * typed word. The HUD (WPM, score, goal) is React DOM in the panel — this
 * module only draws the game scene, theme-driven via the colours in `opts`.
 */

import type { Game } from './engine'
import { MAX_PRESSURE, MAX_SHIELD } from './engine'

export interface RenderTheme {
  path: string
  pathEdge: string
  worm: string
  wormEdge: string
  stone: string
  stoneEdge: string
  text: string
  danger: string
  accent: string
}

export interface RenderOpts {
  width: number
  height: number
  /** ms timestamp, used for idle wobble + shake. */
  now: number
  reducedMotion: boolean
  theme: RenderTheme
}

// Scene margins (px) reserved at top (castle) and bottom (worm entry).
const TOP_MARGIN = 58
const BOTTOM_MARGIN = 26
const PATH_WAVES = 2.4
const PATH_AMPLITUDE = 0.3 // fraction of width (peak, at the path's middle)
const TOWER_OFFSET = 22 // px a tower sits outside the path point, on the crest
const TAU = Math.PI * 2

interface Pt {
  x: number
  y: number
}

/**
 * Map a path parameter t (0 = entry/bottom, 1 = castle/top) to screen xy.
 * The horizontal wiggle is enveloped by sin(πt) so it tapers to zero at both
 * ends — the path enters bottom-centre and resolves straight into a centred
 * castle, keeping the gate away from a bend.
 */
function pathPoint(t: number, w: number, h: number): Pt {
  const yBottom = h - BOTTOM_MARGIN
  const yTop = TOP_MARGIN
  const y = yBottom + (yTop - yBottom) * t
  const cx = w / 2
  const env = Math.sin(Math.PI * t)
  const x = cx + Math.sin(t * PATH_WAVES * TAU) * (w * PATH_AMPLITUDE) * env
  return { x, y }
}

export function draw(ctx: CanvasRenderingContext2D, game: Game, opts: RenderOpts): void {
  const { width: w, height: h, theme } = opts
  ctx.clearRect(0, 0, w, h)

  const pressureRatio = game.stats.pressure / MAX_PRESSURE

  // Gentle screen shake when the gate is under pressure.
  let shakeX = 0
  if (!opts.reducedMotion && pressureRatio > 0.4) {
    const mag = (pressureRatio - 0.4) * 6
    shakeX = Math.sin(opts.now / 45) * mag
  }
  ctx.save()
  ctx.translate(shakeX, 0)

  drawPath(ctx, w, h, theme)
  drawCastle(ctx, w, h, pressureRatio, opts)
  drawSiegers(ctx, game, w, h, opts)
  drawWorms(ctx, game, w, h, opts)
  drawTowers(ctx, game, w, h, opts)
  drawProjectiles(ctx, game, w, h, theme)
  drawShield(ctx, game.stats.shield, w, h, opts)

  ctx.restore()
}

function drawPath(ctx: CanvasRenderingContext2D, w: number, h: number, theme: RenderTheme): void {
  const trace = () => {
    ctx.beginPath()
    for (let i = 0; i <= 80; i++) {
      const p = pathPoint(i / 80, w, h)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // soft drop shadow
  trace()
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 20
  ctx.stroke()
  // edge + fill
  trace()
  ctx.strokeStyle = theme.pathEdge
  ctx.lineWidth = 18
  ctx.stroke()
  trace()
  ctx.strokeStyle = theme.path
  ctx.lineWidth = 12
  ctx.stroke()
  // dashed centre line, like a little road
  trace()
  ctx.setLineDash([3, 7])
  ctx.strokeStyle = theme.pathEdge
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.setLineDash([])
}

/** A merlon-topped stone tower centred at (x, baseY bottom), drawn upward. */
function drawTowerShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottomY: number,
  width: number,
  height: number,
  theme: RenderTheme,
): void {
  const left = x - width / 2
  const top = bottomY - height
  // body
  ctx.fillStyle = theme.stone
  ctx.strokeStyle = theme.stoneEdge
  ctx.lineWidth = 1.5
  roundRect(ctx, left, top, width, height, 2)
  ctx.fill()
  ctx.stroke()
  // battlements (3 merlons)
  const merlonW = width / 5
  ctx.fillStyle = theme.stone
  for (let i = 0; i < 3; i++) {
    const mx = left + (i * 2 * merlonW)
    ctx.beginPath()
    ctx.rect(mx, top - merlonW, merlonW, merlonW + 1)
    ctx.fill()
    ctx.stroke()
  }
}

function drawCastle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pressureRatio: number,
  opts: RenderOpts,
): void {
  const top = pathPoint(1, w, h)
  const theme = opts.theme

  // danger glow grows with the siege
  if (pressureRatio > 0.02) {
    ctx.save()
    ctx.globalAlpha = Math.min(0.6, 0.15 + pressureRatio * 0.55)
    ctx.shadowColor = theme.danger
    ctx.shadowBlur = 24
    ctx.fillStyle = theme.danger
    ctx.beginPath()
    ctx.arc(top.x, top.y - 2, 22, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  const baseY = top.y + 12
  // flanking towers, then the taller keep, so the keep overlaps in front
  drawTowerShape(ctx, top.x - 13, baseY, 11, 22, theme)
  drawTowerShape(ctx, top.x + 13, baseY, 11, 22, theme)
  drawTowerShape(ctx, top.x, baseY, 16, 30, theme)

  // gate (dark arch) on the keep
  ctx.fillStyle = theme.stoneEdge
  roundRect(ctx, top.x - 4, baseY - 11, 8, 11, 3)
  ctx.fill()

  // flag on the keep
  const flagTop = baseY - 30
  ctx.strokeStyle = theme.stoneEdge
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(top.x, flagTop)
  ctx.lineTo(top.x, flagTop - 9)
  ctx.stroke()
  const wave = opts.reducedMotion ? 0 : Math.sin(opts.now / 200) * 1.5
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.moveTo(top.x, flagTop - 9)
  ctx.lineTo(top.x + 8 + wave, flagTop - 6.5)
  ctx.lineTo(top.x, flagTop - 4)
  ctx.closePath()
  ctx.fill()
}

/** A small segmented bookworm centred at (x, y), head toward the top. */
function drawWorm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theme: RenderTheme,
  tough: boolean,
): void {
  ctx.save()
  // shadow
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(x, y + 7, 7, 2.5, 0, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = 1

  if (tough) {
    ctx.globalAlpha = 0.6
    ctx.strokeStyle = theme.danger
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, 9.5, 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // body segments (head on top)
  const segs = [
    { dy: 6, r: 4.2 },
    { dy: 1.5, r: 4.8 },
    { dy: -3.5, r: 5.4 },
  ]
  ctx.strokeStyle = theme.wormEdge
  ctx.lineWidth = 1.5
  for (const s of segs) {
    ctx.beginPath()
    ctx.arc(x, y + s.dy, s.r, 0, TAU)
    ctx.fillStyle = theme.worm
    ctx.fill()
    ctx.stroke()
  }

  // eyes on the head
  const hy = y - 4.5
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x - 2, hy, 1.7, 0, TAU)
  ctx.arc(x + 2, hy, 1.7, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#1f2937'
  ctx.beginPath()
  ctx.arc(x - 2, hy + 0.3, 0.9, 0, TAU)
  ctx.arc(x + 2, hy + 0.3, 0.9, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function drawSiegers(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  opts: RenderOpts,
): void {
  for (const s of game.siegers) {
    const p = pathPoint(s.t, w, h)
    drawWorm(ctx, p.x, p.y, opts.theme, s.maxHp > 1)
    // impact spark at the top of a fling, when it taps the gate
    if (!opts.reducedMotion && s.t > 0.97) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, (s.t - 0.97) / 0.03)
      ctx.fillStyle = opts.theme.danger
      ctx.beginPath()
      ctx.arc(p.x, p.y - 8, 2.4, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
  }
}

function drawWorms(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  opts: RenderOpts,
): void {
  for (const worm of game.bookworms) {
    const p = pathPoint(worm.t, w, h)
    const wob = opts.reducedMotion ? 0 : Math.sin(opts.now / 200 + worm.wobble) * 3
    drawWorm(ctx, p.x + wob, p.y, opts.theme, worm.maxHp > 1)
  }
}

function drawTowers(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  opts: RenderOpts,
): void {
  for (const tower of game.towers) {
    const p = pathPoint(tower.t, w, h)
    const x = p.x + tower.side * TOWER_OFFSET
    const baseY = p.y + 11
    if (tower.flash > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, tower.flash / 0.12)
      ctx.shadowColor = '#fde68a'
      ctx.shadowBlur = 12
      ctx.fillStyle = '#fde68a'
      ctx.beginPath()
      ctx.arc(x, baseY - 18, 6, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    drawTowerShape(ctx, x, baseY, 14, 22, opts.theme)
  }
}

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  theme: RenderTheme,
): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const proj of game.projectiles) {
    const from = pathPoint(proj.fromT, w, h)
    const fromX = from.x + proj.fromSide * TOWER_OFFSET
    const to = pathPoint(proj.targetT, w, h)
    const x = fromX + (to.x - fromX) * proj.progress
    const y = from.y + (to.y - from.y) * proj.progress
    const fading = proj.progress > 0.75
    ctx.save()
    ctx.globalAlpha = fading ? Math.max(0, 1 - (proj.progress - 0.75) / 0.25) : 1

    if (proj.targetId == null) {
      // Nothing to fight — the towers send the castle some love instead of
      // a word-shot. A pink heart drifts up to the keep.
      drawHeart(ctx, x, y, 13, '#ec4899')
    } else {
      ctx.font = '600 11px ui-monospace, monospace'
      ctx.fillStyle = theme.accent
      const label = proj.word.length > 12 ? proj.word.slice(0, 11) + '…' : proj.word
      const bw = ctx.measureText(label).width + 8
      roundRect(ctx, x - bw / 2, y - 8, bw, 16, 5)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, x, y)
    }
    ctx.restore()
  }
}

/** A protective dome over the castle, built from banked "love" (hearts). */
function drawShield(
  ctx: CanvasRenderingContext2D,
  shield: number,
  w: number,
  h: number,
  opts: RenderOpts,
): void {
  if (shield <= 0) return
  const c = pathPoint(1, w, h)
  const ratio = Math.min(1, shield / MAX_SHIELD)
  const cx = c.x
  const cy = c.y + 4
  const r = 30 + ratio * 8
  const shimmer = opts.reducedMotion ? 0 : Math.sin(opts.now / 320) * 0.06
  ctx.save()
  ctx.globalAlpha = 0.25 + ratio * 0.4 + shimmer
  ctx.strokeStyle = '#f9a8d4' // pink-300
  ctx.shadowColor = '#ec4899'
  ctx.shadowBlur = 12
  ctx.lineWidth = 2.5
  // a bubble dome over the keep
  ctx.beginPath()
  ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 2.18, false)
  ctx.stroke()
  ctx.restore()
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  const top = s * 0.3
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.moveTo(x, y + s * 0.28)
  ctx.bezierCurveTo(x, y + s * 0.1, x - s / 2, y + s * 0.1, x - s / 2, y - top)
  ctx.bezierCurveTo(x - s / 2, y - s * 0.6, x, y - s * 0.55, x, y - s * 0.28)
  ctx.bezierCurveTo(x, y - s * 0.55, x + s / 2, y - s * 0.6, x + s / 2, y - top)
  ctx.bezierCurveTo(x + s / 2, y + s * 0.1, x, y + s * 0.1, x, y + s * 0.28)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
