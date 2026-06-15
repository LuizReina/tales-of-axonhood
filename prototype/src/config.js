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

// Classes jogáveis. Guerreiro = corpo-a-corpo tanque; Mago = dano à distância frágil.
export const CLASSES = {
  warrior: {
    name: 'Guerreiro',
    baseHp: 85, hpPerLevel: 18,
    baseAtk: 7, atkPerLevel: 2,
    baseDef: 2,
    attackRange: 48, attackCooldown: 0.8,
    attackKind: 'melee',
    color: '#ff7a59',
  },
  mage: {
    name: 'Mago',
    baseHp: 52, hpPerLevel: 11,
    baseAtk: 11, atkPerLevel: 3,
    baseDef: 0,
    attackRange: 270, attackCooldown: 1.1,
    attackKind: 'ranged',
    color: '#4ea1ff',
  },
};

export const DEFAULT_CLASS = 'warrior';
