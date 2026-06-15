// Ponto de entrada: trata o login, cria a conexão e liga as mensagens do servidor ao
// estado + HUD + render. É a "cola" — em Unity, o equivalente é um GameManager/Bootstrapper.
import { Net } from './net.js';
import { state, applyState } from './state.js';
import { setupInput } from './input.js';
import { startRender } from './render.js';
import * as ui from './ui.js';

export const VERSION = 'v0.2.0';
const el = (id) => document.getElementById(id);
const canvas = el('game');
if (el('version')) el('version').textContent = `Tales of Axonhood ${VERSION}`;
if (el('verTag')) el('verTag').textContent = VERSION;

// Decide a URL do servidor. Local (localhost/file) usa o próprio host; hospedado estaticamente
// (GitHub Pages) precisa de um servidor externo informado via ?server=wss://… senão não há onde conectar.
function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const h = location.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1') return `ws://${location.host || 'localhost:3000'}`;
  return null;
}

// Captura qualquer erro de JS e mostra na tela (loginHint) + console, para diagnosticar fácil.
function showErr(msg) { const h = el('loginHint'); if (h) { h.style.color = '#ff6b6b'; h.textContent = '⚠ ' + msg; } }
addEventListener('error', (e) => { console.error('[erro global]', e.error || e.message); showErr(String(e.message)); });
addEventListener('unhandledrejection', (e) => { console.error('[promessa rejeitada]', e.reason); showErr(String(e.reason)); });
console.log('[main] script carregado');

// Identidade por aba: sessionStorage difere entre abas (ótimo p/ testar multiplayer local)
// e sobrevive a recarregar a mesma aba (persistência do personagem).
let playerId = sessionStorage.getItem('axon_pid');
if (!playerId) { playerId = (crypto.randomUUID?.() || 'pid-' + Math.random().toString(36).slice(2)); sessionStorage.setItem('axon_pid', playerId); }

let chosenClass = 'warrior';
document.querySelectorAll('.cls').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.cls').forEach((x) => x.classList.remove('sel'));
  b.classList.add('sel'); chosenClass = b.dataset.cls;
});
el('name').value = sessionStorage.getItem('axon_name') || '';
el('enter').onclick = start;
el('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

function start() {
  const name = el('name').value.trim();
  sessionStorage.setItem('axon_name', name);
  const url = serverUrl();
  if (!url) {
    showErr('Este é o cliente estático (GitHub Pages) — não há servidor aqui. Rode o servidor local (veja o README) e abra http://localhost:3000, ou informe ?server=wss://SEU-SERVIDOR na URL.');
    return;
  }
  el('loginHint').style.color = '';
  el('loginHint').textContent = 'Conectando…';
  console.log('[main] start() — playerId:', playerId, 'classe:', chosenClass, 'servidor:', url);

  const net = new Net(url);
  net.on('open', () => { console.log('[main] enviando hello'); net.hello(playerId, name, chosenClass); });
  net.on('close', () => el('loginHint').textContent = 'Conexão perdida. Recarregue a página.');
  wire(net);
}

let started = false, deathTimer = null;

function wire(net) {
  net.on('init', (m) => {
    console.log('[main] init recebido — id:', m.id);
    state.myId = m.id; state.world = m.world; state.cellSize = m.cellSize; state.aoiRadius = m.aoiRadius;
    state.items = m.items; state.self = m.self;
    el('login').hidden = true; el('hud').hidden = false;
    ui.renderSelf(); ui.renderInventory();
    if (!started) {
      started = true;
      ui.setupHandlers(net);
      setupInput(net, canvas);
      startRender(canvas);
    }
    console.log('[main] entrou no mundo ✓');
  });

  net.on('state', (m) => { applyState(m); ui.renderTarget(); });

  net.on('you', (m) => {
    Object.assign(state.self, { hp: m.hp, maxHp: m.maxHp, xp: m.xp, xpNext: m.xpNext, level: m.level, atk: m.atk, def: m.def });
    ui.renderSelf();
  });

  net.on('inv', (m) => {
    state.self.inventory = m.inventory; state.self.equipment = m.equipment;
    ui.renderInventory();
  });

  net.on('sys', (m) => ui.pushChat('sys', esc(m.text)));
  net.on('chat', (m) => ui.pushChat(m.channel, `<b>${esc(m.from)}</b>: ${esc(m.text)}`));

  net.on('party', (m) => { state.party = m.members; ui.renderParty(); });
  net.on('guild', (m) => {
    state.guild = m.guild;
    if (state.self) state.self.guildName = m.guild ? m.guild.name : null;
    ui.renderGuild(); ui.renderSelf();
  });
  net.on('invite', (m) => { state.invite = m; ui.showInvite(); });

  net.on('hit', (m) => state.hits.push({ ...m, born: performance.now() }));

  net.on('dead', (m) => {
    state.dead = true;
    const until = performance.now() + m.respawnIn * 1000;
    ui.showDeath(m.respawnIn);
    clearInterval(deathTimer);
    deathTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      ui.showDeath(left);
      if (left <= 0) clearInterval(deathTimer);
    }, 200);
  });
  net.on('respawn', () => { state.dead = false; clearInterval(deathTimer); ui.hideDeath(); });
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
