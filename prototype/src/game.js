// Núcleo autoritativo do jogo: mantém o estado verdadeiro, roteia as mensagens dos clientes
// e roda o tick com todos os sistemas (movimento, IA, combate, loot, progressão, AOI).
// O cliente (web hoje, Unity depois) só manda intenção e desenha o que recebe daqui.
import { PLAYER, CELL_SIZE, AOI_RADIUS, CLASSES, DEFAULT_CLASS, SAVE_INTERVAL } from './config.js';
import { WORLD, PLAYER_SPAWN, MOB_SPAWNS, ARENA, moveResolved, cellOf } from './world.js';
import { ITEMS, MOBS } from './data.js';
import { deriveStats, addXp, xpForNext } from './progression.js';
import { addItem, consumeSlot, hasSpace } from './inventory.js';
import { loadCharacter, saveCharacter, guildStore, flush } from './persistence.js';
import * as social from './social.js';

const players = new Map(); // serverId -> player
const mobs = new Map();    // mobId -> mob
const ground = new Map();  // groundId -> { id, x, y, item, qty, expireAt }
let nextId = 1, nextMobId = 1, nextGroundId = 1;
let saveAcc = 0;

const now = () => Date.now();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const send = (p, obj) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); };

const inArena = (p) => p.x >= ARENA.x && p.x <= ARENA.x + ARENA.w && p.y >= ARENA.y && p.y <= ARENA.y + ARENA.h;

// Está "b" (ponto qualquer) dentro da AOI de "a"?
function inAOI(a, b) {
  const ca = cellOf(a.x, a.y), cb = cellOf(b.x, b.y);
  return Math.abs(ca.cx - cb.cx) <= AOI_RADIUS && Math.abs(ca.cy - cb.cy) <= AOI_RADIUS;
}
function* nearbyPlayers(x, y) {
  for (const p of players.values()) if (inAOI(p, { x, y })) yield p;
}

// ---------- mobs ----------
export function initMobs() {
  for (const s of MOB_SPAWNS) {
    const def = MOBS[s.kind];
    const id = nextMobId++;
    mobs.set(id, {
      id, kind: s.kind, def, spawnX: s.x, spawnY: s.y,
      x: s.x, y: s.y, hp: def.hp, atkCd: 0, dead: false, respawnAt: 0, lastAttacker: null,
    });
  }
}

// ---------- jogador ----------
function recompute(p) {
  const s = deriveStats(p);
  Object.assign(p, s);
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}

function buildSelf(p) {
  return {
    id: p.id, name: p.name, cls: p.cls, color: p.color,
    level: p.level, xp: p.xp, xpNext: xpForNext(p.level),
    hp: p.hp, maxHp: p.maxHp, atk: p.atk, def: p.def,
    attackRange: p.attackRange, attackKind: p.attackKind,
    inventory: p.inventory, equipment: p.equipment,
    guildName: p.guildName, partyId: p.partyId || null,
  };
}
const sendYou = (p) => send(p, {
  t: 'you', hp: p.hp, maxHp: p.maxHp, xp: p.xp, xpNext: xpForNext(p.level),
  level: p.level, atk: p.atk, def: p.def,
});
const sendInv = (p) => send(p, { t: 'inv', inventory: p.inventory, equipment: p.equipment });
const sys = (p, text) => send(p, { t: 'sys', text });

export function handleConnection(ws) {
  const id = nextId++;
  let player = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!player) { if (m.t === 'hello') player = spawnPlayer(ws, id, m); return; }
    route(player, m);
  });
  ws.on('close', () => {
    if (!player) return;
    persist(player);
    const r = social.leaveParty(player);
    if (r) notifyParty(r.members);
    for (const o of players.values()) if (o.targetId === player.id && o.targetType === 'player') { o.targetType = null; o.targetId = null; }
    players.delete(player.id);
  });
}

function spawnPlayer(ws, id, hello) {
  const playerId = String(hello.playerId || `anon-${id}`);
  const saved = loadCharacter(playerId);
  const cls = (saved?.cls && CLASSES[saved.cls]) ? saved.cls
    : (CLASSES[hello.cls] ? hello.cls : DEFAULT_CLASS);
  const name = (saved?.name || hello.name || `Herói${id}`).toString().slice(0, 16);

  const p = {
    ws, id, playerId, name, cls,
    x: saved?.x ?? PLAYER_SPAWN.x, y: saved?.y ?? PLAYER_SPAWN.y,
    input: { up: false, down: false, left: false, right: false },
    level: saved?.level ?? 1, xp: saved?.xp ?? 0,
    inventory: saved?.inventory ?? [{ item: 'potion_small', qty: 3 }],
    equipment: saved?.equipment ?? { weapon: cls === 'mage' ? 'staff_oak' : 'sword_short', armor: null },
    guildName: saved?.guildName ?? null, partyId: null,
    targetType: null, targetId: null, atkCd: 0, teleCd: 0, dead: false, respawnAt: 0,
    color: CLASSES[cls].color, hp: 1,
  };
  recompute(p);
  p.hp = p.maxHp;
  players.set(id, p);

  send(p, {
    t: 'init', id, world: WORLD, cellSize: CELL_SIZE, aoiRadius: AOI_RADIUS, self: buildSelf(p), items: ITEMS,
  });
  if (p.guildName) sendGuild(p);
  return p;
}

function persist(p) {
  saveCharacter(p.playerId, {
    name: p.name, cls: p.cls, level: p.level, xp: p.xp, x: p.x, y: p.y,
    inventory: p.inventory, equipment: p.equipment, guildName: p.guildName,
  });
}

// ---------- roteamento de mensagens ----------
function route(p, m) {
  switch (m.t) {
    case 'input':
      if (!p.dead) p.input = { up: !!m.up, down: !!m.down, left: !!m.left, right: !!m.right };
      break;
    case 'target':
      if (m.kind === 'mob' && mobs.has(m.id)) { p.targetType = 'mob'; p.targetId = m.id; }
      else if (m.kind === 'player' && players.has(m.id)) { p.targetType = 'player'; p.targetId = m.id; }
      break;
    case 'untarget': p.targetType = null; p.targetId = null; break;
    case 'useSlot': useSlot(p, m.index); break;
    case 'unequip': unequip(p, m.slot); break;
    case 'party': handleParty(p, m); break;
    case 'guild': handleGuild(p, m); break;
    case 'chat': handleChat(p, m); break;
  }
}

function useSlot(p, index) {
  const slot = p.inventory[index];
  if (!slot) return;
  const def = ITEMS[slot.item];
  if (!def) return;
  if (def.type === 'consumable' && def.heal) {
    if (p.hp >= p.maxHp) return sys(p, 'Sua vida já está cheia.');
    p.hp = Math.min(p.maxHp, p.hp + def.heal);
    consumeSlot(p.inventory, index);
    sendYou(p); sendInv(p);
  } else if (def.type === 'weapon' || def.type === 'armor') {
    const eqSlot = def.type === 'weapon' ? 'weapon' : 'armor';
    const prev = p.equipment[eqSlot];
    consumeSlot(p.inventory, index);
    p.equipment[eqSlot] = slot.item;
    if (prev) addItem(p.inventory, prev, 1);
    recompute(p); sendYou(p); sendInv(p);
    sys(p, `Equipou ${def.name}.`);
  } else {
    sys(p, 'Esse item não pode ser usado.');
  }
}

function unequip(p, eqSlot) {
  if (eqSlot !== 'weapon' && eqSlot !== 'armor') return;
  const id = p.equipment[eqSlot];
  if (!id) return;
  if (!hasSpace(p.inventory, id)) return sys(p, 'Inventário cheio.');
  addItem(p.inventory, id, 1);
  p.equipment[eqSlot] = null;
  recompute(p); sendYou(p); sendInv(p);
}

function handleParty(p, m) {
  if (m.action === 'invite') {
    const target = players.get(m.id);
    if (!target || target.id === p.id) return;
    const r = social.invitePlayer(p, target);
    if (!r.ok) return sys(p, r.reason);
    send(target, { t: 'invite', kind: 'party', from: p.name, fromId: p.id });
    sys(p, `Convite enviado para ${target.name}.`);
    notifyParty([...r.party.members]);
  } else if (m.action === 'accept') {
    const r = social.acceptInvite(p);
    if (!r.ok) return sys(p, r.reason);
    notifyParty([...r.party.members]);
  } else if (m.action === 'leave') {
    const r = social.leaveParty(p);
    sendParty(p);
    if (r) notifyParty(r.members);
  }
}

function handleGuild(p, m) {
  if (m.action === 'invite') {
    const target = players.get(m.id);
    if (!target || target.id === p.id) return;
    const r = social.inviteToGuild(p, target);
    if (!r.ok) return sys(p, r.reason);
    send(target, { t: 'invite', kind: 'guild', from: p.name, guild: p.guildName });
    return sys(p, `Convite de guilda enviado para ${target.name}.`);
  }
  if (m.action === 'acceptInvite') {
    const r = social.acceptGuildInvite(p);
    if (!r.ok) return sys(p, r.reason);
    persist(p); sendGuild(p);
    return sys(p, `Entrou na guilda "${r.guild.name}".`);
  }
  let r;
  if (m.action === 'create') r = social.createGuild(p, m.name);
  else if (m.action === 'join') r = social.joinGuild(p, m.name);
  else if (m.action === 'leave') { social.leaveGuild(p); sendGuild(p); persist(p); return; }
  else return;
  if (!r.ok) return sys(p, r.reason);
  persist(p);
  sendGuild(p);
  sys(p, m.action === 'create' ? `Guilda "${r.guild.name}" criada!` : `Entrou na guilda "${r.guild.name}".`);
}

function handleChat(p, m) {
  const text = (m.text || '').toString().slice(0, 200).trim();
  if (!text) return;
  const ch = m.channel === 'party' || m.channel === 'guild' ? m.channel : 'global';
  const msg = { t: 'chat', channel: ch, from: p.name, text };
  if (ch === 'global') { for (const o of players.values()) send(o, msg); }
  else if (ch === 'party') {
    const party = social.partyOf(p);
    if (!party) return sys(p, 'Você não está em grupo.');
    for (const id of party.members) { const o = players.get(id); if (o) send(o, msg); }
  } else {
    if (!p.guildName) return sys(p, 'Você não está em guilda.');
    for (const o of players.values()) if (o.guildName === p.guildName) send(o, msg);
  }
}

// ---------- party/guild: envio de estado ----------
function sendParty(p) {
  const party = social.partyOf(p);
  if (!party) return send(p, { t: 'party', members: null });
  const members = [...party.members].map((id) => players.get(id)).filter(Boolean).map((o) => ({
    id: o.id, name: o.name, cls: o.cls, level: o.level, hp: o.hp, maxHp: o.maxHp, leader: o.id === party.leader,
  }));
  send(p, { t: 'party', members });
}
function notifyParty(ids) {
  for (const id of ids) { const o = players.get(id); if (o) sendParty(o); }
}
function sendGuild(p) {
  if (!p.guildName || !guildStore[p.guildName]) return send(p, { t: 'guild', guild: null });
  const g = guildStore[p.guildName];
  let online = 0;
  for (const o of players.values()) if (o.guildName === g.name) online++;
  send(p, { t: 'guild', guild: { name: g.name, members: g.members.map((mm) => mm.name), online } });
}

// ---------- combate / loot / morte ----------
function emitHit(ax, ay, tx, ty, amount, kind, fatal) {
  const msg = { t: 'hit', ax, ay, tx, ty, amount, kind, fatal: !!fatal };
  for (const p of nearbyPlayers(tx, ty)) send(p, msg);
}

function killMob(mob, killer) {
  mob.dead = true;
  mob.respawnAt = now() + (mob.def.respawn || 8) * 1000;
  // loot no chão
  for (const entry of mob.def.loot || []) {
    if (Math.random() < entry.chance) {
      const gid = nextGroundId++;
      ground.set(gid, {
        id: gid, item: entry.item, qty: entry.qty || 1,
        x: mob.x + (Math.random() * 40 - 20), y: mob.y + (Math.random() * 40 - 20),
        expireAt: now() + 60000,
      });
    }
  }
  // limpa quem mirava nesse mob
  for (const p of players.values()) if (p.targetType === 'mob' && p.targetId === mob.id) { p.targetType = null; p.targetId = null; }
  if (killer) grantXp(killer, mob);
}

function grantXp(killer, mob) {
  const party = social.partyOf(killer);
  let recipients = [killer];
  if (party) {
    // XP dividido IGUALMENTE entre todos os membros do grupo (ex.: 20 de XP, grupo de 2 = 10 cada).
    recipients = [...party.members].map((id) => players.get(id)).filter(Boolean);
    if (recipients.length === 0) recipients = [killer];
  }
  const share = Math.max(1, Math.floor(mob.def.xp / recipients.length));
  for (const p of recipients) {
    const leveled = addXp(p, share);
    if (leveled) { recompute(p); p.hp = p.maxHp; sys(p, `Subiu para o nível ${p.level}!`); }
    sys(p, `+${share} XP (${mob.def.name})`);
    sendYou(p);
  }
}

function killPlayer(p) {
  p.dead = true; p.hp = 0;
  p.respawnAt = now() + PLAYER.respawnTime * 1000;
  p.targetType = null; p.targetId = null;
  p.input = { up: false, down: false, left: false, right: false };
  send(p, { t: 'dead', respawnIn: PLAYER.respawnTime });
}

// ---------- tick ----------
export function step(dt) {
  // 1) movimento dos players
  for (const p of players.values()) {
    if (p.dead) continue;
    let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const r = moveResolved(p.x, p.y, (dx / len) * PLAYER.speed * dt, (dy / len) * PLAYER.speed * dt, PLAYER.radius);
      p.x = r.x; p.y = r.y;
    }
    if (p.atkCd > 0) p.atkCd -= dt;
    // portais: encostar teleporta (com cooldown para não repetir ao chegar)
    if (p.teleCd > 0) p.teleCd -= dt;
    else for (const portal of WORLD.portals) {
      if (Math.hypot(p.x - portal.x, p.y - portal.y) < 30) {
        p.x = portal.tx; p.y = portal.ty; p.teleCd = 3;
        sys(p, portal.id === 1 ? 'Você entrou na arena de Phanton HorseFace…' : 'Você saiu da arena.');
        break;
      }
    }
  }

  // 2) IA dos mobs
  for (const mob of mobs.values()) {
    if (mob.dead) {
      if (now() >= mob.respawnAt) { mob.dead = false; mob.hp = mob.def.hp; mob.x = mob.spawnX; mob.y = mob.spawnY; mob.atkCd = 0; }
      continue;
    }
    if (mob.atkCd > 0) mob.atkCd -= dt;

    // frases do boss ("na tela", via balão acima dele)
    if (mob.def.taunts) {
      mob.tauntCd = (mob.tauntCd || 0) - dt;
      if (mob.tauntCd <= 0) {
        mob.say = { text: mob.def.taunts[Math.floor(Math.random() * mob.def.taunts.length)], until: now() + 2500 };
        mob.tauntCd = 3 + Math.random() * 3;
      }
    }

    // alvo: player vivo mais próximo no aggro. O boss só enxerga quem está NA ARENA e com HP > 1.
    let target = null, best = mob.def.aggroRange;
    for (const p of players.values()) {
      if (p.dead) continue;
      if (mob.def.boss && (!inArena(p) || p.hp <= 1)) continue;
      const d = dist(mob, p);
      if (d < best) { best = d; target = p; }
    }
    if (target) {
      const d = dist(mob, target);
      const reach = mob.def.attackRange + PLAYER.radius;
      if (d > reach) {
        const ux = (target.x - mob.x) / d, uy = (target.y - mob.y) / d;
        const r = moveResolved(mob.x, mob.y, ux * mob.def.speed * dt, uy * mob.def.speed * dt, mob.def.radius);
        mob.x = r.x; mob.y = r.y;
      } else if (mob.atkCd <= 0) {
        mob.atkCd = mob.def.attackCooldown;
        if (mob.def.leaveAt1) {
          // nunca mata: ataca à distância e deixa o alvo sempre com 1 de HP
          if (target.hp > 1) {
            const dmg = target.hp - 1;
            target.hp = 1;
            emitHit(mob.x, mob.y, target.x, target.y, dmg, 'ranged', false);
            sendYou(target);
          }
        } else {
          const dmg = Math.max(1, mob.def.atk - target.def);
          target.hp -= dmg;
          emitHit(mob.x, mob.y, target.x, target.y, dmg, 'melee', target.hp <= 0);
          sendYou(target);
          if (target.hp <= 0) killPlayer(target);
        }
      }
    } else if (mob.def.speed > 0) {
      // sem alvo: volta devagar para o ponto de origem (o boss fica parado)
      const d = dist(mob, { x: mob.spawnX, y: mob.spawnY });
      if (d > 4) {
        const ux = (mob.spawnX - mob.x) / d, uy = (mob.spawnY - mob.y) / d;
        const r = moveResolved(mob.x, mob.y, ux * mob.def.speed * 0.5 * dt, uy * mob.def.speed * 0.5 * dt, mob.def.radius);
        mob.x = r.x; mob.y = r.y;
      }
    }
  }

  // 3) ataque automático dos players no alvo (mob) em alcance
  for (const p of players.values()) {
    if (p.dead || p.targetType !== 'mob') continue;
    const mob = mobs.get(p.targetId);
    if (!mob || mob.dead) { p.targetType = null; p.targetId = null; continue; }
    const d = dist(p, mob);
    if (d <= p.attackRange + mob.def.radius && p.atkCd <= 0) {
      p.atkCd = p.attackCooldown;
      const dmg = Math.max(1, p.atk - mob.def.def);
      mob.hp -= dmg;
      mob.lastAttacker = p.id;
      emitHit(p.x, p.y, mob.x, mob.y, dmg, p.attackKind, mob.hp <= 0);
      if (mob.hp <= 0) killMob(mob, p);
    }
  }

  // 4) respawn de players
  for (const p of players.values()) {
    if (p.dead && now() >= p.respawnAt) {
      p.dead = false; p.x = PLAYER_SPAWN.x; p.y = PLAYER_SPAWN.y; p.hp = p.maxHp;
      send(p, { t: 'respawn' }); sendYou(p);
    }
  }

  // 5) coleta automática de itens no chão
  for (const g of ground.values()) {
    if (now() >= g.expireAt) { ground.delete(g.id); continue; }
    for (const p of players.values()) {
      if (p.dead) continue;
      if (dist(p, g) <= PLAYER.pickupRange && hasSpace(p.inventory, g.item)) {
        addItem(p.inventory, g.item, g.qty);
        ground.delete(g.id);
        sendInv(p);
        sys(p, `Pegou ${ITEMS[g.item]?.name || g.item}${g.qty > 1 ? ` x${g.qty}` : ''}.`);
        break;
      }
    }
  }

  // 6) snapshot por AOI para cada player
  for (const p of players.values()) {
    if (p.ws.readyState !== 1) continue;
    const me = cellOf(p.x, p.y);
    const vp = [], vm = [], vg = [];
    for (const o of players.values()) if (inAOI(p, o)) vp.push({ id: o.id, name: o.name, cls: o.cls, color: o.color, x: Math.round(o.x), y: Math.round(o.y), hp: o.hp, maxHp: o.maxHp, level: o.level, dead: o.dead });
    for (const mob of mobs.values()) if (!mob.dead && inAOI(p, mob)) vm.push({ id: mob.id, kind: mob.kind, name: mob.def.name, color: mob.def.color, radius: mob.def.radius, x: Math.round(mob.x), y: Math.round(mob.y), hp: mob.hp, maxHp: mob.def.hp, boss: !!mob.def.boss, say: (mob.say && now() < mob.say.until) ? mob.say.text : null });
    for (const g of ground.values()) if (inAOI(p, g)) vg.push({ id: g.id, item: g.item, name: ITEMS[g.item]?.name, color: ITEMS[g.item]?.color, x: Math.round(g.x), y: Math.round(g.y) });
    send(p, { t: 'state', cell: me, players: vp, mobs: vm, ground: vg, target: p.targetId && p.targetType ? { kind: p.targetType, id: p.targetId } : null });
  }

  // 7) save periódico
  saveAcc += dt;
  if (saveAcc >= SAVE_INTERVAL) {
    saveAcc = 0;
    for (const p of players.values()) persist(p);
    flush();
  }
}
