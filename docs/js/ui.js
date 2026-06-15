// HUD em DOM: lê o `state` e pinta painéis (vida, xp, alvo, grupo, guilda, inventário, chat).
// >>> FRONTEIRA DE MIGRAÇÃO <<< Vira UI Toolkit/uGUI no Unity. Nenhuma regra de jogo aqui.
import { state, castSkill } from './state.js';

const el = (id) => document.getElementById(id);

export function renderSelf() {
  const s = state.self; if (!s) return;
  el('selfName').textContent = s.name;
  el('selfCls').textContent = s.className || (s.cls === 'mage' ? 'Mago' : 'Guerreiro');
  el('selfLvl').textContent = s.level;
  el('selfAtk').textContent = s.atk;
  el('selfDef').textContent = s.def;
  el('selfGold').textContent = s.gold ?? 0;
  el('selfGuild').textContent = s.guildName ? `🛡 ${s.guildName}` : 'sem guilda';
  bar('hpFill', 'hpTxt', s.hp, s.maxHp, `${s.hp}/${s.maxHp}`);
  bar('xpFill', 'xpTxt', s.xp, s.xpNext, `XP ${s.xp}/${s.xpNext}`);
}

// Hotbar de skills (1..N). Cooldown é mostrado a partir de um carimbo local ao usar.
export function renderSkills() {
  const bar = el('hotbar');
  const skills = (state.self && state.self.skills) || [];
  bar.innerHTML = '';
  skills.forEach((sk, i) => {
    const d = document.createElement('div');
    d.className = 'skill'; d.dataset.id = sk.id; d.title = `${sk.name} (recarga ${sk.cooldown}s)`;
    d.innerHTML = `<span class="key">${i + 1}</span><span class="nm">${sk.name}</span><span class="cd"></span>`;
    d.onclick = () => castSkill(sk.id);
    bar.appendChild(d);
  });
}

// Atualiza visual de cooldown a cada frame (chamado pelo render loop).
export function tickSkillCooldowns() {
  const now = performance.now();
  for (const d of el('hotbar').children) {
    const end = state.skillCd[d.dataset.id] || 0;
    const left = (end - now) / 1000;
    if (left > 0) { d.classList.add('cooling'); d.querySelector('.cd').textContent = left.toFixed(1); }
    else d.classList.remove('cooling');
  }
}

export function renderTarget() {
  const t = state.target;
  const panel = el('targetPanel');
  if (!t) { panel.hidden = true; return; }
  const e = t.kind === 'mob' ? state.mobs.get(t.id) : state.players.get(t.id);
  if (!e) { panel.hidden = true; return; }
  panel.hidden = false;
  el('targetName').textContent = e.name + (e.level ? ` Lv${e.level}` : '');
  bar('tHpFill', 'tHpTxt', e.hp, e.maxHp, `${Math.max(0, Math.round(e.hp))}/${e.maxHp}`);
}

export function renderInventory() {
  const s = state.self; if (!s) return;
  drawCell(el('eqWeapon'), s.equipment.weapon);
  drawCell(el('eqArmor'), s.equipment.armor);
  const grid = el('invGrid'); grid.innerHTML = '';
  s.inventory.forEach((slot, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell'; cell.dataset.index = i;
    drawCell(cell, slot.item, slot.qty);
    grid.appendChild(cell);
  });
}

function drawCell(cell, itemId, qty) {
  cell.innerHTML = '';
  if (!itemId) return;
  const def = (state.items && state.items[itemId]) || {};
  cell.title = def.name || itemId;
  const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = def.color || '#888';
  cell.appendChild(dot);
  if (qty > 1) { const q = document.createElement('span'); q.className = 'q'; q.textContent = qty; cell.appendChild(q); }
}

export function renderParty() {
  const panel = el('partyPanel');
  if (!state.party || !state.party.length) { panel.hidden = true; return; }
  panel.hidden = false;
  el('partyList').innerHTML = state.party.map((m) => `
    <div class="pmember">
      <div class="small">${esc(m.name)}${m.leader ? ' 👑' : ''} · Lv${m.level}</div>
      <div class="bar hp small"><span style="width:${pct(m.hp, m.maxHp)}%"></span></div>
    </div>`).join('');
}

export function renderGuild() {
  const panel = el('guildPanel'), body = el('guildBody');
  if (state.guild) {
    panel.hidden = false;
    body.innerHTML = `
      <div class="row"><b>${esc(state.guild.name)}</b> <span class="small">(${state.guild.online} on)</span></div>
      <div class="small" style="margin:6px 0">${state.guild.members.map(esc).join(', ')}</div>
      <div class="row"><button id="guildInvite">Convidar alvo</button><button class="ghost" id="guildLeave">Sair</button></div>`;
    el('guildLeave').onclick = () => state._net.guild('leave');
    el('guildInvite').onclick = () => {
      if (state.selectedPlayerId) state._net.guild('invite', state.selectedPlayerId);
      else pushChat('sys', 'Clique num jogador para selecioná-lo antes de convidar.');
    };
  } else {
    body.innerHTML = `
      <input id="guildName" placeholder="Nome da guilda" maxlength="24" />
      <div class="row"><button id="guildCreate">Criar</button><button id="guildJoin" class="ghost">Entrar</button></div>`;
    el('guildCreate').onclick = () => state._net.guild('create', el('guildName').value);
    el('guildJoin').onclick = () => state._net.guild('join', el('guildName').value);
  }
}
export function toggleGuild() { const p = el('guildPanel'); p.hidden = !p.hidden; if (!p.hidden) renderGuild(); }
export function toggleInventory() { const p = el('inventory'); p.hidden = !p.hidden; if (!p.hidden) renderInventory(); }

// ---- Missões ----
export function renderQuests() {
  const body = el('questBody'), q = state.quests;
  if (!q) { body.innerHTML = '<div class="small">Sem missões.</div>'; return; }
  let html = '<div class="qsec">Principal</div>';
  html += q.main ? questCard(q.main, 'main') : '<div class="small">Todas concluídas! 🎉</div>';
  html += '<div class="qsec">Diárias</div>';
  for (const d of q.dailies) html += questCard(d, 'daily');
  body.innerHTML = html;
  body.querySelectorAll('button[data-claim]').forEach((b) => b.onclick = () => {
    if (b.dataset.kind === 'main') state._net.quest('claimMain');
    else state._net.quest('claimDaily', b.dataset.id);
  });
}
function questCard(qq, kind) {
  const btn = qq.done ? '<button disabled>Concluída ✔</button>'
    : qq.claimable ? `<button data-claim data-kind="${kind}" data-id="${qq.id}">Receber recompensa</button>`
    : '<button disabled>Em progresso</button>';
  return `<div class="quest ${qq.done ? 'done' : ''}"><div class="qn">${esc(qq.name)}</div>
    <div class="qd">${esc(qq.desc)}</div><div class="qp">${qq.progress}/${qq.count}</div>${btn}</div>`;
}
export function toggleQuests() { const p = el('questPanel'); p.hidden = !p.hidden; if (!p.hidden) renderQuests(); }

// ---- Loja ----
export function openShop() { el('shopPanel').hidden = false; renderShop(); }
export function refreshShop() { if (!el('shopPanel').hidden) renderShop(); }
function renderShop() {
  if (!state.shop) return;
  el('shopGold').textContent = state.self ? state.self.gold : 0;
  const buy = el('shopBuy'); buy.innerHTML = '';
  for (const e of state.shop.buy) {
    const it = state.items[e.item] || {};
    const row = document.createElement('div'); row.className = 'shopItem';
    row.innerHTML = `<span>${esc(it.name || e.item)}</span><span><span class="price">${e.price}🪙</span> <button>Comprar</button></span>`;
    row.querySelector('button').onclick = () => state._net.shop('buy', { item: e.item });
    buy.appendChild(row);
  }
  const sell = el('shopSell'); sell.innerHTML = '';
  (state.self ? state.self.inventory : []).forEach((slot, i) => {
    const price = state.shop.sell[slot.item]; if (!price) return;
    const it = state.items[slot.item] || {};
    const row = document.createElement('div'); row.className = 'shopItem';
    row.innerHTML = `<span>${esc(it.name || slot.item)}${slot.qty > 1 ? ` x${slot.qty}` : ''}</span><span><span class="price">${price}🪙</span> <button>Vender</button></span>`;
    row.querySelector('button').onclick = () => state._net.shop('sell', { index: i });
    sell.appendChild(row);
  });
  if (!sell.innerHTML) sell.innerHTML = '<div class="small">Nada vendável.</div>';
}

export function showCheckin(m) {
  el('checkinTxt').innerHTML = `🎁 <b>Recompensa diária!</b><br>+${m.gold} ouro e 1 ${esc(m.item)}`;
  el('checkinPopup').hidden = false;
}

export function pushChat(channel, html) {
  const log = el('chatLog');
  const ln = document.createElement('div');
  ln.className = `ln ${channel}`; ln.innerHTML = html;
  log.appendChild(ln); log.scrollTop = log.scrollHeight;
  while (log.childElementCount > 80) log.removeChild(log.firstChild);
}

export function showInvite() {
  if (!state.invite) return;
  const i = state.invite;
  el('inviteTxt').textContent = i.kind === 'guild'
    ? `${i.from} convidou você para a guilda "${i.guild}".`
    : `${i.from} convidou você para o grupo.`;
  el('invitePopup').hidden = false;
}
export const hideInvite = () => { el('invitePopup').hidden = true; state.invite = null; };

export function showDeath(sec) { el('deathOverlay').hidden = false; el('respawnSec').textContent = sec; }
export const hideDeath = () => { el('deathOverlay').hidden = true; };

// Liga handlers estáticos (delegação de cliques, formulários, chat, convite).
export function setupHandlers(net) {
  state._net = net;
  document.querySelectorAll('[data-close]').forEach((b) =>
    (b.onclick = () => (el(b.dataset.close).hidden = true)));

  el('invGrid').onclick = (e) => {
    const cell = e.target.closest('.cell'); if (!cell) return;
    net.useSlot(Number(cell.dataset.index));
  };
  el('eqWeapon').onclick = () => net.unequip('weapon');
  el('eqArmor').onclick = () => net.unequip('armor');

  el('inviteAccept').onclick = () => {
    if (state.invite?.kind === 'guild') net.guild('acceptInvite'); else net.party('accept');
    hideInvite();
  };
  el('inviteDecline').onclick = hideInvite;
  el('checkinOk').onclick = () => { el('checkinPopup').hidden = true; };

  const chat = el('chatText');
  chat.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const text = chat.value.trim();
      if (text) net.chat(el('chatCh').value, text);
      chat.value = ''; chat.blur(); e.stopPropagation();
    } else if (e.key === 'Escape') chat.blur();
  };
}

function bar(fillId, txtId, val, max, label) {
  el(fillId).style.width = pct(val, max) + '%';
  el(txtId).textContent = label;
}
const pct = (v, m) => Math.max(0, Math.min(100, (v / (m || 1)) * 100));
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
