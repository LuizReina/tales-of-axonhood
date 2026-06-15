// Lógica de missões (principal em cadeia + diárias). Mexe só no estado de quests do player
// e calcula progresso/condições; quem dá recompensa e envia mensagens é o game.js.
import { QUESTS } from './data.js';

export const today = () => new Date().toISOString().slice(0, 10);

export function initQuests(saved) {
  return saved || { mainIndex: 0, mainProgress: 0, dailyDate: null, dailyProgress: {}, dailyDone: [] };
}

// Reseta as diárias quando vira o dia.
export function ensureDaily(q) {
  const t = today();
  if (q.dailyDate !== t) { q.dailyDate = t; q.dailyProgress = {}; q.dailyDone = []; }
}

export const currentMain = (q) => (q.mainIndex < QUESTS.main.length ? QUESTS.main[q.mainIndex] : null);

const invCount = (player, itemId) =>
  player.inventory.reduce((n, s) => n + (s.item === itemId ? s.qty : 0), 0);

export function recordKill(player, kind) {
  const q = player.quests;
  const main = currentMain(q);
  if (main && main.type === 'kill' && main.target === kind && q.mainProgress < main.count) q.mainProgress++;
  for (const d of QUESTS.daily) {
    if (d.type === 'kill' && d.target === kind && !q.dailyDone.includes(d.id)) {
      q.dailyProgress[d.id] = Math.min(d.count, (q.dailyProgress[d.id] || 0) + 1);
    }
  }
}

export function recordVisit(player, area) {
  const main = currentMain(player.quests);
  if (main && main.type === 'visit' && main.area === area) player.quests.mainProgress = main.count;
}

export function mainProgress(player) {
  const main = currentMain(player.quests);
  if (!main) return 0;
  return main.type === 'collect' ? Math.min(main.count, invCount(player, main.item)) : player.quests.mainProgress;
}
export const isMainClaimable = (player) => {
  const main = currentMain(player.quests);
  return !!main && mainProgress(player) >= main.count;
};

export function dailyProgress(player, d) {
  return d.type === 'collect' ? Math.min(d.count, invCount(player, d.item)) : (player.quests.dailyProgress[d.id] || 0);
}
export const isDailyClaimable = (player, d) =>
  !player.quests.dailyDone.includes(d.id) && dailyProgress(player, d) >= d.count;

// Snapshot para o cliente desenhar o painel de missões.
export function buildQuestState(player) {
  const main = currentMain(player.quests);
  return {
    main: main ? {
      id: main.id, name: main.name, desc: main.desc,
      progress: mainProgress(player), count: main.count, claimable: isMainClaimable(player),
    } : null,
    dailies: QUESTS.daily.map((d) => ({
      id: d.id, name: d.name, desc: d.desc,
      progress: dailyProgress(player, d), count: d.count,
      claimable: isDailyClaimable(player, d), done: player.quests.dailyDone.includes(d.id),
    })),
  };
}
