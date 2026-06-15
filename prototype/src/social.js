// Party (grupo) é efêmero, vive só em memória. Guild é persistida (ver persistence.js).
// Estas funções mexem só nos dados de membership e devolvem info; quem envia mensagens
// para os clientes é o game.js.
import { guildStore, markGuildsDirty } from './persistence.js';

const MAX_PARTY = 5;

let nextPartyId = 1;
export const parties = new Map();        // id -> { id, leader, members:Set<serverId> }
const partyInvites = new Map();          // inviteeServerId -> { partyId, fromName }

export const partyOf = (p) => (p.partyId ? parties.get(p.partyId) : null);

export function invitePlayer(leader, invitee) {
  if (invitee.partyId) return { ok: false, reason: 'Jogador já está em grupo.' };
  let party = partyOf(leader);
  if (!party) {
    party = { id: nextPartyId++, leader: leader.id, members: new Set([leader.id]) };
    parties.set(party.id, party);
    leader.partyId = party.id;
  }
  if (party.members.size >= MAX_PARTY) return { ok: false, reason: 'Grupo cheio.' };
  partyInvites.set(invitee.id, { partyId: party.id, fromName: leader.name });
  return { ok: true, party };
}

export function acceptInvite(invitee) {
  const inv = partyInvites.get(invitee.id);
  partyInvites.delete(invitee.id);
  if (!inv) return { ok: false, reason: 'Nenhum convite pendente.' };
  const party = parties.get(inv.partyId);
  if (!party) return { ok: false, reason: 'O grupo não existe mais.' };
  if (party.members.size >= MAX_PARTY) return { ok: false, reason: 'Grupo cheio.' };
  party.members.add(invitee.id);
  invitee.partyId = party.id;
  return { ok: true, party };
}

// Remove o player do grupo. Devolve o grupo afetado + ids que precisam ser notificados.
export function leaveParty(player) {
  const party = partyOf(player);
  if (!party) return null;
  party.members.delete(player.id);
  player.partyId = null;
  const affected = [...party.members];

  if (party.members.size <= 1) {            // sobrou 0 ou 1 -> dissolve o grupo
    for (const id of party.members) affected.push(id);
    parties.delete(party.id);
    return { disbanded: true, members: affected, remaining: [...party.members] };
  }
  if (party.leader === player.id) party.leader = party.members.values().next().value;
  return { disbanded: false, members: affected, remaining: affected };
}

// ---- Guild (persistente; membros guardados por playerId + nome para exibição) ----
export function createGuild(player, rawName) {
  const name = (rawName || '').trim().slice(0, 24);
  if (!name) return { ok: false, reason: 'Nome inválido.' };
  if (player.guildName) return { ok: false, reason: 'Você já está numa guilda.' };
  if (guildStore[name]) return { ok: false, reason: 'Esse nome já existe.' };
  guildStore[name] = { name, owner: player.playerId, members: [{ id: player.playerId, name: player.name }] };
  player.guildName = name;
  markGuildsDirty();
  return { ok: true, guild: guildStore[name] };
}

export function joinGuild(player, rawName) {
  const name = (rawName || '').trim();
  if (player.guildName) return { ok: false, reason: 'Você já está numa guilda.' };
  const g = guildStore[name];
  if (!g) return { ok: false, reason: 'Guilda não encontrada.' };
  if (!g.members.some((m) => m.id === player.playerId)) g.members.push({ id: player.playerId, name: player.name });
  player.guildName = name;
  markGuildsDirty();
  return { ok: true, guild: g };
}

export function leaveGuild(player) {
  const name = player.guildName;
  if (!name) return null;
  player.guildName = null;
  const g = guildStore[name];
  if (g) {
    g.members = g.members.filter((m) => m.id !== player.playerId);
    if (g.members.length === 0) delete guildStore[name];
    markGuildsDirty();
  }
  return { name, guild: g };
}
