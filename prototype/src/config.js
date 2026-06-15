// Constantes de jogo num só lugar. Em Unity, isto vira um ScriptableObject / arquivo de config
// consumido pelo servidor; o cliente nunca decide esses números (servidor autoritativo).

export const PORT = 3000;
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

// Grade de Area of Interest (AOI): cada player só recebe entidades nas células vizinhas.
export const CELL_SIZE = 240;
export const AOI_RADIUS = 1; // bloco 3x3 de células

export const PLAYER = {
  radius: 13,
  speed: 185,
  pickupRange: 30,
  respawnTime: 4,
};

export const INVENTORY_SLOTS = 24;
export const SAVE_INTERVAL = 5; // segundos entre saves automáticos

// Classes jogáveis em CADEIA de evolução (tier 0 → 1 → 2). Ao atingir `advanceLevel`,
// o personagem avança para `advancesTo` — classes superiores têm stats e skills melhores.
// Cada classe lista suas skills ativas (desbloqueadas por nível via `unlock`).
//   kind: 'single' = um alvo · 'aoe' = todos os mobs num raio · power = multiplicador do ATK.
export const CLASSES = {
  // ----- Linha do Guerreiro (corpo-a-corpo, tanque) -----
  warrior: {
    name: 'Guerreiro', base: 'warrior', tier: 0, advancesTo: 'knight', advanceLevel: 5,
    baseHp: 85, hpPerLevel: 18, baseAtk: 7, atkPerLevel: 2, baseDef: 2,
    attackRange: 48, attackCooldown: 0.8, attackKind: 'melee', color: '#ff7a59',
    skills: [
      { id: 'slash', name: 'Golpe Forte', kind: 'single', power: 1.8, cooldown: 4, range: 64, unlock: 2 },
    ],
  },
  knight: {
    name: 'Cavaleiro', base: 'warrior', tier: 1, advancesTo: 'warlord', advanceLevel: 12,
    baseHp: 125, hpPerLevel: 24, baseAtk: 10, atkPerLevel: 3, baseDef: 4,
    attackRange: 52, attackCooldown: 0.75, attackKind: 'melee', color: '#ff9d3a',
    skills: [
      { id: 'slash', name: 'Golpe Forte', kind: 'single', power: 2.0, cooldown: 3.5, range: 68, unlock: 1 },
      { id: 'charge', name: 'Investida', kind: 'aoe', power: 1.5, cooldown: 8, radius: 95, range: 80, unlock: 7 },
    ],
  },
  warlord: {
    name: 'Senhor da Guerra', base: 'warrior', tier: 2, advancesTo: null, advanceLevel: null,
    baseHp: 180, hpPerLevel: 32, baseAtk: 14, atkPerLevel: 4, baseDef: 7,
    attackRange: 56, attackCooldown: 0.7, attackKind: 'melee', color: '#ffb627',
    skills: [
      { id: 'slash', name: 'Golpe Forte', kind: 'single', power: 2.3, cooldown: 3, range: 72, unlock: 1 },
      { id: 'charge', name: 'Investida', kind: 'aoe', power: 1.8, cooldown: 7, radius: 110, range: 90, unlock: 1 },
      { id: 'quake', name: 'Terremoto', kind: 'aoe', power: 2.6, cooldown: 12, radius: 160, range: 0, unlock: 14 },
    ],
  },
  // ----- Linha do Mago (à distância, frágil, AoE) -----
  mage: {
    name: 'Mago', base: 'mage', tier: 0, advancesTo: 'sorcerer', advanceLevel: 5,
    baseHp: 52, hpPerLevel: 11, baseAtk: 11, atkPerLevel: 3, baseDef: 0,
    attackRange: 270, attackCooldown: 1.1, attackKind: 'ranged', color: '#4ea1ff',
    skills: [
      { id: 'fireball', name: 'Bola de Fogo', kind: 'single', power: 2.0, cooldown: 4, range: 300, unlock: 2 },
    ],
  },
  sorcerer: {
    name: 'Feiticeiro', base: 'mage', tier: 1, advancesTo: 'archmage', advanceLevel: 12,
    baseHp: 78, hpPerLevel: 15, baseAtk: 16, atkPerLevel: 4, baseDef: 1,
    attackRange: 290, attackCooldown: 1.0, attackKind: 'ranged', color: '#7c5cff',
    skills: [
      { id: 'fireball', name: 'Bola de Fogo', kind: 'single', power: 2.3, cooldown: 3.5, range: 300, unlock: 1 },
      { id: 'frostnova', name: 'Nova de Gelo', kind: 'aoe', power: 1.8, cooldown: 8, radius: 120, range: 290, unlock: 7 },
    ],
  },
  archmage: {
    name: 'Arquimago', base: 'mage', tier: 2, advancesTo: null, advanceLevel: null,
    baseHp: 105, hpPerLevel: 20, baseAtk: 22, atkPerLevel: 6, baseDef: 2,
    attackRange: 320, attackCooldown: 0.9, attackKind: 'ranged', color: '#b06cff',
    skills: [
      { id: 'fireball', name: 'Bola de Fogo', kind: 'single', power: 2.6, cooldown: 3, range: 320, unlock: 1 },
      { id: 'frostnova', name: 'Nova de Gelo', kind: 'aoe', power: 2.1, cooldown: 7, radius: 140, range: 310, unlock: 1 },
      { id: 'meteor', name: 'Meteoro', kind: 'aoe', power: 3.2, cooldown: 12, radius: 180, range: 320, unlock: 14 },
    ],
  },
};

// Classes com que se pode COMEÇAR (as outras só por evolução).
export const STARTER_CLASSES = ['warrior', 'mage'];
export const DEFAULT_CLASS = 'warrior';
