// Mundo: mapa, colisão e helpers de AOI. Pontos de spawn de mobs também ficam aqui.
import { PLAYER, CELL_SIZE } from './config.js';

export const WORLD = {
  width: 1600,
  height: 1600,
  obstacles: [
    { x: 400, y: 300, w: 170, h: 60 },
    { x: 900, y: 200, w: 60, h: 300 },
    { x: 600, y: 720, w: 320, h: 60 },
    { x: 1120, y: 820, w: 200, h: 200 },
    { x: 200, y: 920, w: 130, h: 130 },
    { x: 1320, y: 320, w: 80, h: 420 },
    // Arena selada do boss (só se entra por portal): 4 paredes formando uma sala.
    { x: 600, y: 1280, w: 400, h: 24 },
    { x: 600, y: 1540, w: 400, h: 24 },
    { x: 600, y: 1280, w: 24, h: 284 },
    { x: 976, y: 1280, w: 24, h: 284 },
  ],
  // Portais: chegar perto teleporta para (tx,ty). Lógica de teleporte fica no servidor.
  portals: [
    { id: 1, x: 1480, y: 180, tx: 800, ty: 1500, label: 'Arena do Boss', color: '#c77dff' },
    { id: 2, x: 800, y: 1330, tx: 140, ty: 140, label: 'Sair', color: '#7bd88f' },
  ],
};

// Retângulo interno da arena (usado para confinar o boss aos players que estão lá dentro).
export const ARENA = { x: 600, y: 1280, w: 400, h: 284 };

// Onde o jogador nasce (longe dos mobs).
export const PLAYER_SPAWN = { x: 140, y: 140 };

// Mobs fixos no mundo (kind + posição de origem; respawnam no mesmo lugar).
export const MOB_SPAWNS = [
  { kind: 'slime', x: 320, y: 240 }, { kind: 'slime', x: 540, y: 520 },
  { kind: 'slime', x: 760, y: 360 }, { kind: 'slime', x: 300, y: 700 },
  { kind: 'slime', x: 1000, y: 300 }, { kind: 'slime', x: 700, y: 980 },
  { kind: 'wolf', x: 1180, y: 560 }, { kind: 'wolf', x: 980, y: 980 },
  { kind: 'wolf', x: 1360, y: 980 }, { kind: 'wolf', x: 520, y: 1040 },
  { kind: 'horseface', x: 800, y: 1460 }, // boss, dentro da arena
];

function hitsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Posição bloqueada? (fora do mundo ou dentro de obstáculo)
export function blocked(cx, cy, r = PLAYER.radius) {
  if (cx < r || cy < r || cx > WORLD.width - r || cy > WORLD.height - r) return true;
  return WORLD.obstacles.some((o) => hitsRect(cx, cy, r, o));
}

// Move resolvendo eixo a eixo (desliza ao raspar parede). Retorna nova posição.
export function moveResolved(x, y, dx, dy, r) {
  if (dx && !blocked(x + dx, y, r)) x += dx;
  if (dy && !blocked(x, y + dy, r)) y += dy;
  return { x, y };
}

export const cellOf = (x, y) => ({ cx: Math.floor(x / CELL_SIZE), cy: Math.floor(y / CELL_SIZE) });
