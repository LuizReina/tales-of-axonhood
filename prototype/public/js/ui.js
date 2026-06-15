// HUD em DOM: lê o `state` e pinta painéis (vida, xp, alvo, grupo, guilda, inventário, chat).
// >>> FRONTEIRA DE MIGRAÇÃO <<< Vira UI Toolkit/uGUI no Unity. Nenhuma regra de jogo aqui.
import { state } from './state.js';

const el = (id) => document.getElementById(id);

export function renderSelf() {
  const s = state.self; if (!s) return;
  el('selfName').textContent = s.name;
  el('selfCls').textContent = s.cls === 'mage' ? 'Mago' : 'Guerreiro';
  el('selfLvl').textContent = s.level;
  el('selfAtk').textContent = s.atk;
  el('selfDef').textContent = s.def;
  el('selfGuild').textContent = s.guildName ? `🛡 ${s.guildName}` : 'sem guilda';
  bar('hpFill', 'hpTxt', s.hp, s.maxHp, `${s.hp}/${s.maxHp}`);
  bar('xpFill', 'xpTxt', s.xp, s.xpNext, `XP ${s.xp}/${s.xpNext}`);
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
      <button class="ghost" id="guildLeave">Sair da guilda</button>`;
    el('guildLeave').onclick = () => state._net.guild('leave');
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

export function pushChat(channel, html) {
  const log = el('chatLog');
  const ln = document.createElement('div');
  ln.className = `ln ${channel}`; ln.innerHTML = html;
  log.appendChild(ln); log.scrollTop = log.scrollHeight;
  while (log.childElementCount > 80) log.removeChild(log.firstChild);
}

export function showInvite() {
  if (!state.invite) return;
  el('inviteTxt').textContent = `${state.invite.from} convidou você para o grupo.`;
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

  el('inviteAccept').onclick = () => { net.party('accept'); hideInvite(); };
  el('inviteDecline').onclick = hideInvite;

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
