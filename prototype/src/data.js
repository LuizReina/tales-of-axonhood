// Carrega as tabelas de conteúdo (itens, mobs) dos JSON. Em Unity estes mesmos JSON viram
// ScriptableObjects ou ficam como JSON em Resources/Addressables — migram praticamente sem mudança.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));

export const ITEMS = load('items.json');
export const MOBS = load('mobs.json');
export const QUESTS = load('quests.json');
export const SHOP = load('shop.json');
