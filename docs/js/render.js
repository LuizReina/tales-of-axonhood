// Desenho no Canvas: câmera seguindo o jogador, fog de AOI, entidades, barras de vida e
// efeitos de combate. >>> FRONTEIRA DE MIGRAÇÃO <<< Tudo aqui é específico de Canvas/HTML e
// será substituído por cenas/prefabs/Sprites no Unity. A LÓGICA não vive aqui — só a pintura.
import { state } from './state.js';
import { tickSkillCooldowns } from './ui.js';

const HIT_LIFETIME = 700;

export function startRender(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function frame() {
    ctx.clearRect(0, 0, W, H);
    if (!state.world) { requestAnimationFrame(frame); return; }

    smooth('p', state.players);
    smooth('m', state.mobs);
    updateCamera(W, H);
    const cam = state.camera;
    const sx = (x) => x - cam.x, sy = (y) => y - cam.y;

    // chão
    ctx.fillStyle = '#252a35';
    ctx.fillRect(sx(0), sy(0), state.world.width, state.world.height);
    // cidade inicial (área segura)
    if (state.world.town) {
      const t = state.world.town;
      ctx.fillStyle = '#2c3a2e';
      ctx.fillRect(sx(t.x), sy(t.y), t.w, t.h);
      ctx.strokeStyle = '#6e8f6e'; ctx.lineWidth = 2;
      ctx.strokeRect(sx(t.x), sy(t.y), t.w, t.h); ctx.lineWidth = 1;
      ctx.fillStyle = '#9fd29f'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'left';
      ctx.fillText('🏰 Cidade Inicial — área segura', sx(t.x) + 10, sy(t.y) + 20);
    }
    // grade de células de AOI
    ctx.strokeStyle = '#ffffff10';
    for (let x = 0; x <= state.world.width; x += state.cellSize) line(ctx, sx(x), sy(0), sx(x), sy(state.world.height));
    for (let y = 0; y <= state.world.height; y += state.cellSize) line(ctx, sx(0), sy(y), sx(state.world.width), sy(y));
    // obstáculos
    ctx.fillStyle = '#3a4252';
    for (const o of state.world.obstacles) ctx.fillRect(sx(o.x), sy(o.y), o.w, o.h);

    // portais
    for (const portal of state.world.portals || []) {
      const px = sx(portal.x), py = sy(portal.y);
      const t = (performance.now() / 600) % (Math.PI * 2);
      ctx.beginPath(); ctx.arc(px, py, 18 + Math.sin(t) * 2, 0, Math.PI * 2);
      ctx.fillStyle = (portal.color || '#c77dff') + '44'; ctx.fill();
      ctx.strokeStyle = portal.color || '#c77dff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(portal.label, px, py - 24);
    }

    // NPCs (losango com nome)
    for (const npc of state.world.npcs || []) {
      const nx = sx(npc.x), ny = sy(npc.y);
      ctx.save();
      ctx.translate(nx, ny); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = npc.color || '#ffd479';
      ctx.fillRect(-11, -11, 22, 22);
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${npc.type === 'shop' ? '🛒 ' : '❗ '}${npc.name} (${npc.role})`, nx, ny - 18);
    }

    // itens no chão
    for (const g of state.ground.values()) {
      ctx.fillStyle = g.color || '#ffd479';
      ctx.fillRect(sx(g.x) - 6, sy(g.y) - 6, 12, 12);
      ctx.strokeStyle = '#000a'; ctx.strokeRect(sx(g.x) - 6, sy(g.y) - 6, 12, 12);
    }

    // mobs
    for (const m of state.mobs.values()) {
      const r = state.rendered.get('m' + m.id) || m;
      drawEntity(ctx, sx(r.x), sy(r.y), m.radius || 15, m.color, m.name, m.hp, m.maxHp,
        state.target && state.target.kind === 'mob' && state.target.id === m.id, '#ff5d73');
      if (m.say) drawBubble(ctx, sx(r.x), sy(r.y) - (m.radius || 15) - 30, m.say);
    }
    // players
    for (const p of state.players.values()) {
      const r = state.rendered.get('p' + p.id) || p;
      const isMe = p.id === state.myId;
      const isSel = state.selectedPlayerId === p.id;
      // pet seguindo (atrás-esquerda do dono)
      if (p.petColor && !p.dead) {
        ctx.beginPath(); ctx.arc(sx(r.x) - 20, sy(r.y) + 10, 7, 0, Math.PI * 2);
        ctx.fillStyle = p.petColor; ctx.fill();
        ctx.strokeStyle = '#0006'; ctx.stroke();
      }
      // anel de montaria sob o player
      if (p.mounted && !p.dead) {
        ctx.beginPath(); ctx.ellipse(sx(r.x), sy(r.y) + 12, 18, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb62755'; ctx.fill(); ctx.strokeStyle = '#ffb627'; ctx.stroke();
      }
      drawEntity(ctx, sx(r.x), sy(r.y), 13, p.color, p.name, p.hp, p.maxHp,
        isSel, '#7bd88f', isMe, p.level, p.dead);
    }

    // efeitos de combate + dano flutuante
    const tnow = performance.now();
    state.hits = state.hits.filter((h) => tnow - h.born < HIT_LIFETIME);
    for (const h of state.hits) {
      const age = (tnow - h.born) / HIT_LIFETIME;
      if (h.kind === 'ranged') {
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = '#9cc2ff'; ctx.lineWidth = 3;
        line(ctx, sx(h.ax), sy(h.ay), sx(h.tx), sy(h.ty));
        ctx.lineWidth = 1; ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = '#ffd479'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx(h.tx), sy(h.ty), 18 + age * 8, 0, Math.PI * 1.5); ctx.stroke();
        ctx.lineWidth = 1; ctx.globalAlpha = 1;
      }
      // número de dano subindo
      ctx.fillStyle = h.fatal ? '#ff5d73' : '#fff';
      ctx.font = `${h.fatal ? 'bold 18' : '14'}px system-ui`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - age;
      ctx.fillText(h.amount, sx(h.tx), sy(h.ty) - 22 - age * 24);
      ctx.globalAlpha = 1;
    }

    drawFog(ctx, W, H, sx, sy);
    tickSkillCooldowns();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function smooth(prefix, map) {
  for (const e of map.values()) {
    const r = state.rendered.get(prefix + e.id);
    if (!r) continue;
    r.x += (e.x - r.x) * 0.3;
    r.y += (e.y - r.y) * 0.3;
  }
}

function updateCamera(W, H) {
  const me = state.rendered.get('p' + state.myId);
  if (!me) return;
  state.camera.x = clamp(me.x - W / 2, 0, Math.max(0, state.world.width - W));
  state.camera.y = clamp(me.y - H / 2, 0, Math.max(0, state.world.height - H));
}

function drawEntity(ctx, x, y, radius, color, name, hp, maxHp, selected, ringColor, isMe, level, dead) {
  if (dead) return;
  if (selected) {
    ctx.strokeStyle = ringColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, radius + 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color || '#aaa'; ctx.fill();
  if (isMe) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; }

  // barra de vida
  const bw = radius * 2.4, bx = x - bw / 2, by = y - radius - 12;
  ctx.fillStyle = '#0009'; ctx.fillRect(bx, by, bw, 4);
  ctx.fillStyle = '#ff5d73'; ctx.fillRect(bx, by, bw * Math.max(0, hp / maxHp), 4);

  // nome (+ level)
  ctx.fillStyle = '#e7e9ee'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(level ? `${name} Lv${level}` : name, x, by - 3);
}

function drawFog(ctx, W, H, sx, sy) {
  if (!state.cell) return;
  const r = state.aoiRadius, cs = state.cellSize;
  const x0 = sx((state.cell.cx - r) * cs), y0 = sy((state.cell.cy - r) * cs);
  const size = (r * 2 + 1) * cs;
  ctx.save();
  ctx.fillStyle = '#0b0d12aa';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(x0, y0, size, size); // buraco (regra even-odd)
  ctx.fill('evenodd');
  ctx.strokeStyle = '#4ea1ff55'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, size, size);
  ctx.restore();
}

function drawBubble(ctx, x, y, text) {
  ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = '#f3e9ff'; ctx.strokeStyle = '#7a3fb0'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 20, w, 24, 6); else ctx.rect(x - w / 2, y - 20, w, 24);
  ctx.fill(); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#2a0a3a'; ctx.fillText(text, x, y - 3);
}

const line = (ctx, x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
const clamp = (v, a, b) => Math.max(a, Math.min(v, b));
