// Estado do mundo no lado do cliente, montado a partir das mensagens do servidor.
// >>> FRONTEIRA DE MIGRAÇÃO <<< O CONCEITO migra para Unity (um "WorldState" alimentado pela rede);
// só a forma de exibir (render/ui) é que será reescrita lá.
export const state = {
  myId: null,
  world: null,
  cellSize: 240,
  aoiRadius: 1,
  cell: null,

  items: {},              // tabela de itens (nome/cor) enviada pelo servidor no init
  self: null,             // stats/inventário do próprio jogador (HUD)
  players: new Map(),     // id -> snapshot visível (na AOI)
  mobs: new Map(),        // id -> snapshot
  ground: new Map(),      // id -> snapshot
  rendered: new Map(),    // chave "p<id>"/"m<id>" -> {x,y} posição suavizada (interpolação)

  target: null,           // {kind,id} alvo atual (confirmado pelo servidor)
  selectedPlayerId: null, // último player clicado (para convite de grupo)

  hits: [],               // efeitos de combate temporários {ax,ay,tx,ty,kind,amount,fatal,born}
  party: null,            // lista de membros ou null
  guild: null,            // {name,members,online} ou null
  invite: null,           // {from,fromId} convite pendente

  dead: false,
  respawnAt: 0,
  camera: { x: 0, y: 0 },
};

// Aplica um snapshot 'state' do servidor às estruturas locais, suavizando posições.
export function applyState(m) {
  state.cell = m.cell;
  state.target = m.target;
  syncMap(state.players, m.players, 'p');
  syncMap(state.mobs, m.mobs, 'm');
  state.ground.clear();
  for (const g of m.ground) state.ground.set(g.id, g);
}

function syncMap(map, list, prefix) {
  const seen = new Set();
  for (const e of list) {
    seen.add(e.id);
    map.set(e.id, e);
    const key = prefix + e.id;
    if (!state.rendered.has(key)) state.rendered.set(key, { x: e.x, y: e.y });
  }
  for (const id of [...map.keys()]) if (!seen.has(id)) { map.delete(id); state.rendered.delete(prefix + id); }
}
