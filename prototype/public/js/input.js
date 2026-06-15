// Entrada do jogador: teclado (movimento + atalhos) e mouse (selecionar alvo).
// >>> FRONTEIRA DE MIGRAÇÃO <<< No Unity isto vira o Input System + raycast de clique.
import { state } from './state.js';
import { toggleInventory, toggleGuild } from './ui.js';

const MOVE = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };

export function setupInput(net, canvas) {
  const keys = { up: false, down: false, left: false, right: false };
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';

  addEventListener('keydown', (e) => {
    if (typing()) return;
    if (MOVE[e.code]) { setMove(net, keys, MOVE[e.code], true); e.preventDefault(); return; }
    switch (e.code) {
      case 'KeyI': toggleInventory(); break;
      case 'KeyG': toggleGuild(); break;
      case 'KeyP': if (state.selectedPlayerId) net.party('invite', state.selectedPlayerId); break;
      case 'KeyL': net.party('leave'); break;
      case 'KeyQ': useFirstPotion(net); break;
      case 'Enter': document.getElementById('chatText').focus(); e.preventDefault(); break;
    }
  });
  addEventListener('keyup', (e) => { if (!typing() && MOVE[e.code]) setMove(net, keys, MOVE[e.code], false); });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) * (canvas.width / rect.width) + state.camera.x;
    const wy = (e.clientY - rect.top) * (canvas.height / rect.height) + state.camera.y;
    pick(net, wx, wy);
  });
}

function setMove(net, keys, dir, pressed) {
  if (keys[dir] === pressed) return;
  keys[dir] = pressed;
  net.input(keys);
}

function useFirstPotion(net) {
  if (!state.self) return;
  const i = state.self.inventory.findIndex((s) => s.item === 'potion_small');
  if (i >= 0) net.useSlot(i);
}

// Seleciona a entidade mais próxima do clique. Mob -> vira alvo de ataque; player -> seleção (convite).
function pick(net, wx, wy) {
  let best = null, bestD = Infinity, bestKind = null;
  for (const m of state.mobs.values()) {
    const d = Math.hypot(m.x - wx, m.y - wy);
    if (d < (m.radius || 15) + 8 && d < bestD) { best = m.id; bestD = d; bestKind = 'mob'; }
  }
  for (const p of state.players.values()) {
    if (p.id === state.myId) continue;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < 21 && d < bestD) { best = p.id; bestD = d; bestKind = 'player'; }
  }
  if (!best) { net.untarget(); state.selectedPlayerId = null; return; }
  if (bestKind === 'mob') { net.target('mob', best); state.selectedPlayerId = null; }
  else { state.selectedPlayerId = best; net.target('player', best); }
}
