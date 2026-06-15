// Núcleo autoritativo do jogo: mantém o estado verdadeiro, roteia as mensagens dos clientes
// e roda o tick com todos os sistemas (movimento, IA, combate, loot, progressão, AOI).
// O cliente (web hoje, Unity depois) só manda intenção e desenha o que recebe daqui.
import { PLAYER, CELL_SIZE, AOI_RADIUS, CLASSES, STARTER_CLASSES, DEFAULT_CLASS, SAVE_INTERVAL } from './config.js';
import { WORLD, PLAYER_SPAWN, MOB_SPAWNS, ARENA, TOWN, moveResolved, cellOf } from './world.js';
import { ITEMS, MOBS, SHOP, QUESTS, PETS, MOUNTS } from './data.js';
import { deriveStats, addXp, xpForNext, unlockedSkills, maybeAdvance } from './progression.js';
import { addItem, consumeSlot, hasSpace } from './inventory.js';
import { loadCharacter, saveCharacter, guildStore, leaderboardStore, markLeaderDirty, flush } from './persistence.js';
import * as social from './social.js';
import * as quests from './quests.js';

const CHECKIN_REWARD = { gold: 50, item: 'potion_small' };
const ENERGY_MAX = 5;
const EVENT_INTERVAL = 90; // segundos entre eventos mundiais (invasão)
let eventAcc = EVENT_INTERVAL - 25; // primeiro evento ~25s após subir o servidor

const players = new Map(); // serverId -> player
const mobs = new Map();    // mobId -> mob
const ground = new Map();  // groundId -> { id, x, y, item, qty, expireAt }
const pendingReq = new Map(); // inviteeServerId -> { kind:'duel'|'marry', fromId } (convites de duelo/casamento)
let nextId = 1, nextMobId = 1, nextGroundId = 1;
let saveAcc = 0;

const now = () => Date.now();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const send = (p, obj) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); };

const inArena = (p) => p.x >= ARENA.x && p.x <= ARENA.x + ARENA.w && p.y >= ARENA.y && p.y <= ARENA.y + ARENA.h;
const inTown = (e) => e.x >= TOWN.x && e.x <= TOWN.x + TOWN.w && e.y >= TOWN.y && e.y <= TOWN.y + TOWN.h;

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
  const pet = p.pet && PETS[p.pet]; // bônus passivo do pet ativo
  if (pet) { p.atk += pet.bonus.atk || 0; p.def += pet.bonus.def || 0; p.maxHp += pet.bonus.hp || 0; }
  if (p.spouse) p.maxHp = Math.floor(p.maxHp * 1.05); // bônus de casamento (+5% HP)
  p.color = CLASSES[p.cls].color;
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}

function buildSelf(p) {
  return {
    id: p.id, name: p.name, cls: p.cls, className: CLASSES[p.cls].name, color: p.color,
    level: p.level, xp: p.xp, xpNext: xpForNext(p.level), gold: p.gold,
    hp: p.hp, maxHp: p.maxHp, atk: p.atk, def: p.def,
    attackRange: p.attackRange, attackKind: p.attackKind,
    inventory: p.inventory, equipment: p.equipment, skills: unlockedSkills(p),
    refine: p.refine, pets: p.pets, pet: p.pet, mounts: p.mounts, mount: p.mount, mounted: p.mounted,
    spouseName: p.spouseName, inDuel: !!p.duel, energy: p.energy, energyMax: ENERGY_MAX,
    guildName: p.guildName, partyId: p.partyId || null,
  };
}
const sendYou = (p) => send(p, {
  t: 'you', hp: p.hp, maxHp: p.maxHp, xp: p.xp, xpNext: xpForNext(p.level),
  level: p.level, atk: p.atk, def: p.def, gold: p.gold,
  cls: p.cls, className: CLASSES[p.cls].name, color: p.color, skills: unlockedSkills(p),
  refine: p.refine, pets: p.pets, pet: p.pet, mounts: p.mounts, mount: p.mount, mounted: p.mounted,
  spouseName: p.spouseName, inDuel: !!p.duel, energy: p.energy, energyMax: ENERGY_MAX,
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
    if (player.duel) endDuelFor(player); // sai do duelo, oponente vence por W.O.
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
  // classe salva pode ser qualquer uma (já evoluída); novo personagem só começa nas iniciais.
  const cls = (saved?.cls && CLASSES[saved.cls]) ? saved.cls
    : (STARTER_CLASSES.includes(hello.cls) ? hello.cls : DEFAULT_CLASS);
  const name = (saved?.name || hello.name || `Herói${id}`).toString().slice(0, 16);

  const p = {
    ws, id, playerId, name, cls,
    x: saved?.x ?? PLAYER_SPAWN.x, y: saved?.y ?? PLAYER_SPAWN.y,
    input: { up: false, down: false, left: false, right: false },
    level: saved?.level ?? 1, xp: saved?.xp ?? 0, gold: saved?.gold ?? 0,
    inventory: saved?.inventory ?? [{ item: 'potion_small', qty: 3 }],
    equipment: saved?.equipment ?? { weapon: cls === 'mage' ? 'staff_oak' : 'sword_short', armor: null },
    refine: saved?.refine ?? {},
    pets: saved?.pets ?? [], pet: saved?.pet ?? null,
    mounts: saved?.mounts ?? [], mount: saved?.mount ?? null, mounted: false,
    spouse: saved?.spouse ?? null, spouseName: saved?.spouseName ?? null, duel: null,
    energy: saved?.energy ?? ENERGY_MAX, energyDate: saved?.energyDate ?? null,
    quests: quests.initQuests(saved?.quests), lastCheckin: saved?.lastCheckin ?? null,
    guildName: saved?.guildName ?? null, partyId: null,
    targetType: null, targetId: null, atkCd: 0, teleCd: 0, skillCd: {}, dead: false, respawnAt: 0,
    color: CLASSES[cls].color, hp: 1,
  };
  quests.ensureDaily(p.quests);
  if (p.energyDate !== quests.today()) { p.energy = ENERGY_MAX; p.energyDate = quests.today(); } // energia reseta por dia
  recompute(p);
  p.hp = p.maxHp;
  players.set(id, p);

  send(p, {
    t: 'init', id, world: WORLD, cellSize: CELL_SIZE, aoiRadius: AOI_RADIUS, self: buildSelf(p), items: ITEMS, shop: SHOP, pets: PETS, mounts: MOUNTS,
  });
  if (p.guildName) sendGuild(p);

  // recompensa de login diário
  const t = quests.today();
  if (p.lastCheckin !== t) {
    p.lastCheckin = t;
    p.gold += CHECKIN_REWARD.gold;
    addItem(p.inventory, CHECKIN_REWARD.item, 1);
    send(p, { t: 'checkin', gold: CHECKIN_REWARD.gold, item: ITEMS[CHECKIN_REWARD.item]?.name || CHECKIN_REWARD.item });
    sendYou(p); sendInv(p);
  }
  sendQuests(p);
  return p;
}

const sendQuests = (p) => send(p, { t: 'quests', ...quests.buildQuestState(p) });

function persist(p) {
  saveCharacter(p.playerId, {
    name: p.name, cls: p.cls, level: p.level, xp: p.xp, gold: p.gold, x: p.x, y: p.y,
    inventory: p.inventory, equipment: p.equipment, refine: p.refine, guildName: p.guildName,
    pets: p.pets, pet: p.pet, mounts: p.mounts, mount: p.mount,
    spouse: p.spouse, spouseName: p.spouseName, energy: p.energy, energyDate: p.energyDate,
    quests: p.quests, lastCheckin: p.lastCheckin,
  });
  leaderboardStore[p.playerId] = { name: p.name, level: p.level, power: p.atk + p.def + p.maxHp };
  markLeaderDirty();
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
    case 'skill': useSkill(p, m.id); break;
    case 'quest':
      if (m.action === 'claimMain') claimMain(p);
      else if (m.action === 'claimDaily') claimDaily(p, m.id);
      break;
    case 'shop':
      if (m.action === 'buy') shopBuy(p, m.item);
      else if (m.action === 'sell') shopSell(p, m.index);
      break;
    case 'refine': refineEquip(p, m.slot); break;
    case 'duel':
      if (m.action === 'challenge') duelChallenge(p, m.id);
      else if (m.action === 'accept') duelAccept(p);
      break;
    case 'marry':
      if (m.action === 'propose') marryPropose(p, m.id);
      else if (m.action === 'accept') marryAccept(p);
      break;
    case 'rank': sendRank(p); break;
    case 'pet':
      if (m.action === 'buy') petBuy(p, m.id);
      else if (m.action === 'activate') petActivate(p, m.id);
      break;
    case 'mount':
      if (m.action === 'buy') mountBuy(p, m.id);
      else if (m.action === 'toggle') mountToggle(p);
      else if (m.action === 'use') mountUse(p, m.id);
      break;
    case 'useSlot': useSlot(p, m.index); break;
    case 'unequip': unequip(p, m.slot); break;
    case 'party': handleParty(p, m); break;
    case 'guild': handleGuild(p, m); break;
    case 'chat': handleChat(p, m); break;
  }
}

// Aplica uma recompensa (xp/ouro/item) e avisa o cliente.
function applyReward(p, r) {
  if (r.gold) p.gold += r.gold;
  if (r.xp) {
    const lv = addXp(p, r.xp);
    if (lv) { recompute(p); p.hp = p.maxHp; let a; while ((a = maybeAdvance(p))) { recompute(p); p.hp = p.maxHp; sys(p, `★ Evoluiu: ${a.from} → ${a.to}!`); } }
  }
  if (r.item) addItem(p.inventory, r.item, r.itemQty || 1);
  sendYou(p); sendInv(p);
}

function claimMain(p) {
  if (!quests.isMainClaimable(p)) return;
  const main = quests.currentMain(p.quests);
  applyReward(p, main.reward);
  sys(p, `✔ Missão concluída: ${main.name}!`);
  p.quests.mainIndex += 1; p.quests.mainProgress = 0;
  sendQuests(p);
}

function claimDaily(p, id) {
  const def = QUESTS.daily.find((x) => x.id === id);
  if (!def || !quests.isDailyClaimable(p, def)) return;
  applyReward(p, def.reward);
  sys(p, `✔ Diária concluída: ${def.name}!`);
  p.quests.dailyDone.push(id);
  sendQuests(p);
}

function shopBuy(p, item) {
  const entry = SHOP.buy.find((e) => e.item === item);
  if (!entry) return;
  if (p.gold < entry.price) return sys(p, 'Ouro insuficiente.');
  if (!hasSpace(p.inventory, item)) return sys(p, 'Inventário cheio.');
  p.gold -= entry.price; addItem(p.inventory, item, 1);
  sys(p, `Comprou ${ITEMS[item]?.name || item} por ${entry.price} ouro.`);
  sendYou(p); sendInv(p); sendQuests(p);
}

function shopSell(p, index) {
  const slot = p.inventory[index];
  if (!slot) return;
  const price = SHOP.sell[slot.item];
  if (!price) return sys(p, 'Esse item não pode ser vendido.');
  consumeSlot(p.inventory, index); p.gold += price;
  sys(p, `Vendeu ${ITEMS[slot.item]?.name || slot.item} por ${price} ouro.`);
  sendYou(p); sendInv(p); sendQuests(p);
}

const REFINE_MAX = 10;
const refineCost = (level) => 40 * (level + 1); // ouro para ir de `level` para `level+1`

function refineEquip(p, slot) {
  if (slot !== 'weapon' && slot !== 'armor') return;
  const id = p.equipment[slot];
  if (!id) return sys(p, 'Equipe um item nesse espaço primeiro.');
  const cur = p.refine[slot] || 0;
  if (cur >= REFINE_MAX) return sys(p, 'Refino no máximo (+10).');
  const cost = refineCost(cur);
  if (p.gold < cost) return sys(p, `Ouro insuficiente (precisa ${cost}).`);
  p.gold -= cost;
  p.refine[slot] = cur + 1;
  recompute(p);
  sys(p, `${ITEMS[id]?.name || id} refinado para +${p.refine[slot]}!`);
  sendYou(p);
}

function petBuy(p, id) {
  const pet = PETS[id];
  if (!pet) return;
  if (p.pets.includes(id)) return sys(p, 'Você já tem esse pet.');
  if (p.gold < pet.price) return sys(p, 'Ouro insuficiente.');
  p.gold -= pet.price; p.pets.push(id); p.pet = id; // compra já ativa
  recompute(p);
  sys(p, `Adquiriu o pet ${pet.name}!`);
  sendYou(p);
}
function petActivate(p, id) {
  if (id !== null && !p.pets.includes(id)) return;
  p.pet = id; // null = guardar
  recompute(p);
  sendYou(p);
}

function mountBuy(p, id) {
  const mt = MOUNTS[id];
  if (!mt) return;
  if (p.mounts.includes(id)) return sys(p, 'Você já tem essa montaria.');
  if (p.gold < mt.price) return sys(p, 'Ouro insuficiente.');
  p.gold -= mt.price; p.mounts.push(id); p.mount = id;
  sys(p, `Adquiriu a montaria ${mt.name}!`);
  sendYou(p);
}
function mountToggle(p) {
  if (!p.mount) return sys(p, 'Você não tem montaria. Fale com a Domadora.');
  p.mounted = !p.mounted;
  sys(p, p.mounted ? `Montou em ${MOUNTS[p.mount].name}.` : 'Desmontou.');
  sendYou(p);
}
function mountUse(p, id) {
  if (!p.mounts.includes(id)) return;
  if (p.mount === id && p.mounted) { p.mounted = false; sys(p, 'Desmontou.'); }
  else { p.mount = id; p.mounted = true; sys(p, `Montou em ${MOUNTS[id].name}.`); }
  sendYou(p);
}

// ---- Duelo PvP ----
function duelChallenge(p, id) {
  const t = players.get(id);
  if (!t || t.id === p.id) return;
  if (p.duel) return sys(p, 'Você já está em duelo.');
  if (t.duel) return sys(p, 'Esse jogador já está em duelo.');
  pendingReq.set(t.id, { kind: 'duel', fromId: p.id });
  send(t, { t: 'invite', kind: 'duel', from: p.name, fromId: p.id });
  sys(p, `Desafiou ${t.name} para um duelo.`);
}
function duelAccept(p) {
  const req = pendingReq.get(p.id);
  if (!req || req.kind !== 'duel') return sys(p, 'Nenhum desafio pendente.');
  pendingReq.delete(p.id);
  const a = players.get(req.fromId);
  if (!a || a.duel || p.duel) return;
  a.duel = { opp: p.id }; p.duel = { opp: a.id };
  a.hp = a.maxHp; p.hp = p.maxHp;
  a.targetType = 'player'; a.targetId = p.id;
  p.targetType = 'player'; p.targetId = a.id;
  send(a, { t: 'duel', state: 'start', opp: p.name }); sendYou(a);
  send(p, { t: 'duel', state: 'start', opp: a.name }); sendYou(p);
}
function endDuel(winner, loser) {
  for (const x of [winner, loser]) { x.duel = null; x.hp = x.maxHp; if (x.targetType === 'player') { x.targetType = null; x.targetId = null; } }
  send(winner, { t: 'duel', state: 'end', result: 'win', opp: loser.name }); sendYou(winner);
  send(loser, { t: 'duel', state: 'end', result: 'lose', opp: winner.name }); sendYou(loser);
  sys(winner, `🏆 Você venceu o duelo contra ${loser.name}!`);
  sys(loser, `Você perdeu o duelo para ${winner.name}.`);
}
function endDuelFor(p) {
  const opp = p.duel && players.get(p.duel.opp);
  p.duel = null; p.hp = p.maxHp; if (p.targetType === 'player') { p.targetType = null; p.targetId = null; }
  if (opp && opp.duel && opp.duel.opp === p.id) {
    opp.duel = null; opp.hp = opp.maxHp; if (opp.targetType === 'player') { opp.targetType = null; opp.targetId = null; }
    send(opp, { t: 'duel', state: 'end', result: 'win', opp: p.name }); sendYou(opp);
    sys(opp, `${p.name} desistiu — você venceu!`);
  }
}

// ---- Casamento ----
function marryPropose(p, id) {
  const t = players.get(id);
  if (!t || t.id === p.id) return;
  if (p.spouse) return sys(p, 'Você já é casado(a).');
  if (t.spouse) return sys(p, 'Esse jogador já é casado(a).');
  pendingReq.set(t.id, { kind: 'marry', fromId: p.id });
  send(t, { t: 'invite', kind: 'marry', from: p.name, fromId: p.id });
  sys(p, `💍 Você pediu ${t.name} em casamento.`);
}
function marryAccept(p) {
  const req = pendingReq.get(p.id);
  if (!req || req.kind !== 'marry') return sys(p, 'Nenhum pedido pendente.');
  pendingReq.delete(p.id);
  const a = players.get(req.fromId);
  if (!a || a.spouse || p.spouse) return;
  a.spouse = p.playerId; a.spouseName = p.name;
  p.spouse = a.playerId; p.spouseName = a.name;
  recompute(a); recompute(p); persist(a); persist(p);
  for (const x of [a, p]) { sendYou(x); sys(x, '💖 Vocês se casaram! (+5% de HP)'); }
}

// ---- Ranking ----
function sendRank(p) {
  leaderboardStore[p.playerId] = { name: p.name, level: p.level, power: p.atk + p.def + p.maxHp };
  const list = Object.values(leaderboardStore).sort((x, y) => y.power - x.power).slice(0, 10);
  send(p, { t: 'rank', list });
}

function useSkill(p, skillId) {
  if (p.dead) return;
  const skill = unlockedSkills(p).find((s) => s.id === skillId);
  if (!skill || (p.skillCd[skillId] || 0) > 0) return;
  const power = (mob) => Math.max(1, Math.floor(p.atk * skill.power) - mob.def.def);

  if (skill.kind === 'single') {
    if (p.targetType !== 'mob') return sys(p, 'Selecione um alvo.');
    const mob = mobs.get(p.targetId);
    if (!mob || mob.dead) return;
    if (dist(p, mob) > skill.range + mob.def.radius) return sys(p, 'Alvo fora de alcance.');
    p.skillCd[skillId] = skill.cooldown;
    const dmg = power(mob);
    mob.hp -= dmg; mob.lastAttacker = p.id;
    emitHit(p.x, p.y, mob.x, mob.y, dmg, p.attackKind, mob.hp <= 0);
    if (mob.hp <= 0) killMob(mob, p);
  } else { // aoe: centro no alvo (se houver/no alcance) ou no próprio player (skills de raio 0)
    let cx = p.x, cy = p.y;
    if (skill.range > 0) {
      if (p.targetType !== 'mob') return sys(p, 'Selecione um alvo.');
      const t = mobs.get(p.targetId);
      if (!t || t.dead || dist(p, t) > skill.range + t.def.radius) return sys(p, 'Alvo fora de alcance.');
      cx = t.x; cy = t.y;
    }
    p.skillCd[skillId] = skill.cooldown;
    for (const mob of mobs.values()) {
      if (mob.dead) continue;
      if (Math.hypot(mob.x - cx, mob.y - cy) <= skill.radius + mob.def.radius) {
        const dmg = power(mob);
        mob.hp -= dmg; mob.lastAttacker = p.id;
        emitHit(p.x, p.y, mob.x, mob.y, dmg, 'aoe', mob.hp <= 0);
        if (mob.hp <= 0) killMob(mob, p);
      }
    }
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
  if (killer) grantRewards(killer, mob);
  if (mob.temporary) mobs.delete(mob.id); // invasores do evento não renascem
}

// Evento mundial: invasão de mobs temporários no campo central, com anúncio global.
function broadcastGlobal(text) {
  const msg = { t: 'chat', channel: 'global', from: '⚔️ EVENTO', text };
  for (const o of players.values()) send(o, msg);
}
function startEvent() {
  const cx = 1000, cy = 760, def = MOBS.invader;
  for (let i = 0; i < 6; i++) {
    const id = nextMobId++;
    mobs.set(id, {
      id, kind: 'invader', def, spawnX: cx, spawnY: cy,
      x: cx + (Math.random() * 140 - 70), y: cy + (Math.random() * 140 - 70),
      hp: def.hp, atkCd: 0, dead: false, respawnAt: 0, lastAttacker: null,
      temporary: true, despawnAt: now() + 120000,
    });
  }
  broadcastGlobal('INVASÃO! 6 Invasores surgiram no campo central. Derrote-os por recompensas!');
}

function grantRewards(killer, mob) {
  const party = social.partyOf(killer);
  let recipients = [killer];
  if (party) {
    // XP e ouro divididos IGUALMENTE entre todos os membros do grupo.
    recipients = [...party.members].map((id) => players.get(id)).filter(Boolean);
    if (recipients.length === 0) recipients = [killer];
  }
  const xpShare = Math.max(1, Math.floor(mob.def.xp / recipients.length));
  const [gMin, gMax] = mob.def.gold || [0, 0];
  const goldTotal = gMin + Math.floor(Math.random() * (gMax - gMin + 1));
  const goldShare = Math.floor(goldTotal / recipients.length);

  for (const p of recipients) {
    if (goldShare > 0) p.gold += goldShare;
    const leveled = addXp(p, xpShare);
    if (leveled) {
      recompute(p); p.hp = p.maxHp;
      sys(p, `Subiu para o nível ${p.level}!`);
      let adv; // pode subir mais de um tier se ganhou muitos níveis de uma vez
      while ((adv = maybeAdvance(p))) { recompute(p); p.hp = p.maxHp; sys(p, `★ Evoluiu: ${adv.from} → ${adv.to}!`); }
    }
    sys(p, `+${xpShare} XP${goldShare > 0 ? ` · +${goldShare} ouro` : ''} (${mob.def.name})`);
    quests.recordKill(p, mob.kind);
    sendYou(p);
    sendQuests(p);
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
      const spd = PLAYER.speed * (p.mounted && p.mount && MOUNTS[p.mount] ? MOUNTS[p.mount].speedMul : 1);
      const r = moveResolved(p.x, p.y, (dx / len) * spd * dt, (dy / len) * spd * dt, PLAYER.radius);
      p.x = r.x; p.y = r.y;
    }
    if (p.atkCd > 0) p.atkCd -= dt;
    for (const k in p.skillCd) if (p.skillCd[k] > 0) p.skillCd[k] -= dt;
    // portais: encostar teleporta (com cooldown para não repetir ao chegar)
    if (p.teleCd > 0) p.teleCd -= dt;
    else for (const portal of WORLD.portals) {
      if (Math.hypot(p.x - portal.x, p.y - portal.y) < 30) {
        if (portal.cost === 'energy') {
          if (p.energy <= 0) { p.teleCd = 1.5; sys(p, 'Sem energia para entrar na masmorra (reseta amanhã).'); break; }
          p.energy -= 1;
        }
        p.x = portal.tx; p.y = portal.ty; p.teleCd = 3;
        if (portal.id === 1) { sys(p, 'Você entrou na arena de Phanton HorseFace…'); quests.recordVisit(p, 'arena'); sendQuests(p); }
        else if (portal.id === 3) sys(p, `Você entrou na masmorra! Energia restante: ${p.energy}.`);
        else sys(p, 'Você voltou para a cidade.');
        sendYou(p);
        break;
      }
    }
  }

  // 2) IA dos mobs
  for (const mob of mobs.values()) {
    if (mob.temporary && now() >= mob.despawnAt) { mobs.delete(mob.id); continue; } // invasores somem com o tempo
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
      if (inTown(p)) continue; // cidade é área segura: mobs não miram quem está nela
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
        if (!inTown(r)) { mob.x = r.x; mob.y = r.y; } // mobs não entram na cidade
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

  // 3b) duelos PvP: troca de golpes até alguém chegar a 1 de HP (ninguém morre)
  for (const p of players.values()) {
    if (p.dead || !p.duel) continue;
    const opp = players.get(p.duel.opp);
    if (!opp || !opp.duel || opp.duel.opp !== p.id) { endDuelFor(p); continue; }
    if (dist(p, opp) <= p.attackRange + PLAYER.radius && p.atkCd <= 0) {
      p.atkCd = p.attackCooldown;
      const dmg = Math.max(1, p.atk - opp.def);
      opp.hp -= dmg;
      emitHit(p.x, p.y, opp.x, opp.y, dmg, p.attackKind, opp.hp <= 1);
      sendYou(opp);
      if (opp.hp <= 1) endDuel(p, opp);
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
        sendQuests(p);
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
    for (const o of players.values()) if (inAOI(p, o)) vp.push({ id: o.id, name: o.name, cls: o.cls, color: o.color, x: Math.round(o.x), y: Math.round(o.y), hp: o.hp, maxHp: o.maxHp, level: o.level, dead: o.dead, petColor: o.pet && PETS[o.pet] ? PETS[o.pet].color : null, mounted: o.mounted });
    for (const mob of mobs.values()) if (!mob.dead && inAOI(p, mob)) vm.push({ id: mob.id, kind: mob.kind, name: mob.def.name, color: mob.def.color, radius: mob.def.radius, x: Math.round(mob.x), y: Math.round(mob.y), hp: mob.hp, maxHp: mob.def.hp, boss: !!mob.def.boss, say: (mob.say && now() < mob.say.until) ? mob.say.text : null });
    for (const g of ground.values()) if (inAOI(p, g)) vg.push({ id: g.id, item: g.item, name: ITEMS[g.item]?.name, color: ITEMS[g.item]?.color, x: Math.round(g.x), y: Math.round(g.y) });
    send(p, { t: 'state', cell: me, players: vp, mobs: vm, ground: vg, target: p.targetId && p.targetType ? { kind: p.targetType, id: p.targetId } : null });
  }

  // 6b) evento mundial periódico (invasão)
  eventAcc += dt;
  if (eventAcc >= EVENT_INTERVAL) { eventAcc = 0; startEvent(); }

  // 7) save periódico
  saveAcc += dt;
  if (saveAcc >= SAVE_INTERVAL) {
    saveAcc = 0;
    for (const p of players.values()) persist(p);
    flush();
  }
}
