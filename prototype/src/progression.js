// Progressão: XP/level, stats derivados, skills desbloqueadas e evolução de classe.
// Tudo no servidor; o cliente só exibe.
import { CLASSES } from './config.js';
import { ITEMS } from './data.js';

// XP necessário para sair do nível atual. Curva crescente, mas amena (protótipo).
export function xpForNext(level) {
  return Math.floor(50 * Math.pow(level, 1.4));
}

// Stats finais = base da classe (do tier atual) + ganho por nível + bônus dos equipamentos.
export function deriveStats(player) {
  const cls = CLASSES[player.cls] || CLASSES.warrior;
  let maxHp = cls.baseHp + player.level * cls.hpPerLevel;
  let atk = cls.baseAtk + player.level * cls.atkPerLevel;
  let def = cls.baseDef;

  for (const slot of ['weapon', 'armor']) {
    const id = player.equipment[slot];
    const it = id && ITEMS[id];
    if (it) {
      const ref = (player.refine && player.refine[slot]) || 0; // bônus de refino (fase futura)
      atk += (it.atk || 0) + (it.atk ? ref : 0);
      def += (it.def || 0) + (it.def ? ref : 0);
      maxHp += it.hp || 0;
    }
  }
  return {
    maxHp: Math.floor(maxHp), atk: Math.floor(atk), def: Math.floor(def),
    attackRange: cls.attackRange, attackCooldown: cls.attackCooldown, attackKind: cls.attackKind,
  };
}

// Skills da classe atual já liberadas pelo nível (para a hotbar do cliente).
export function unlockedSkills(player) {
  const cls = CLASSES[player.cls] || CLASSES.warrior;
  return (cls.skills || []).filter((s) => player.level >= s.unlock);
}

// Aplica XP, sobe de nível enquanto sobrar; devolve quantos níveis subiu.
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

// Evolui a classe se o nível alcançou o requisito. Devolve { from, to } ou null.
export function maybeAdvance(player) {
  const cls = CLASSES[player.cls];
  if (cls && cls.advancesTo && cls.advanceLevel && player.level >= cls.advanceLevel) {
    const from = cls.name;
    player.cls = cls.advancesTo;
    return { from, to: CLASSES[player.cls].name };
  }
  return null;
}
