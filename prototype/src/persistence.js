// Persistência simples em arquivo JSON (personagens e guildas).
// É o suficiente para o protótipo. Em produção isto vira Postgres/SQLite (ver doc, seção 4);
// o resto do código não muda porque só conversa com estas funções.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '..', 'save');
const CHAR_FILE = join(DIR, 'characters.json');
const GUILD_FILE = join(DIR, 'guilds.json');

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}

// Carregadas uma vez para a memória; escritas de volta com debounce.
const characters = readJson(CHAR_FILE, {}); // playerId -> dados persistidos
const guilds = readJson(GUILD_FILE, {});     // nome -> { name, owner, members[] }

let charDirty = false, guildDirty = false;

export function loadCharacter(playerId) { return characters[playerId] || null; }
export function saveCharacter(playerId, data) { characters[playerId] = data; charDirty = true; }

export const guildStore = guilds;
export function markGuildsDirty() { guildDirty = true; }

// Chamado periodicamente pelo loop; escreve só o que mudou.
export function flush() {
  if (!charDirty && !guildDirty) return;
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true }); // recria a pasta se ela sumir em runtime
  if (charDirty) { writeFileSync(CHAR_FILE, JSON.stringify(characters)); charDirty = false; }
  if (guildDirty) { writeFileSync(GUILD_FILE, JSON.stringify(guilds, null, 2)); guildDirty = false; }
}
