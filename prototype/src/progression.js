// Progressão (XP/level) e cálculo de stats derivados. Tudo no servidor: o cliente só exibe.
import { CLASSES } from './config.js';
import { ITEMS } from './data.js';

// XP necessário para sair do nível atual. Curva simples e crescente.
export function xpForNext(level) {
  return Math.floor(60 * Math.pow(level, 1.5));
}

// Stats finais = base da classe + ganho por nível + bônus dos equipamentos.
export function deriveStats(player) {
  const cls = CLASSES[player.cls] || CLASSES.warrior;
  let maxHp = cls.baseHp + player.level * cls.hpPerLevel;
  let atk = cls.baseAtk + player.level * cls.atkPerLevel;
  let def = cls.baseDef;

  for (const slot of ['weapon', 'armor']) {
    const id = player.equipment[slot];
    const it = id && ITEMS[id];
    if (it) { atk += it.atk || 0; def += it.def || 0; maxHp += it.hp || 0; }
  }
  return {
    maxHp, atk, def,
    attackRange: cls.attackRange,
    attackCooldown: cls.attackCooldown,
    attackKind: cls.attackKind,
  };
}

// Aplica XP, sobe de nível enquanto sobrar, e devolve quantos níveis subiu.
export function addXp(player, amount) {
  player.xp += amount;
  let leveled = 0;
  while (player.xp >= xpForNext(player.level)) {
    player.xp -= xpForNext(player.level);
    player.level += 1;
    leveled += 1;
  }
  return leveled;
}
