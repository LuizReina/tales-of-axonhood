// Helpers de inventário: empilhar, adicionar, remover. Inventário = array de { item, qty }.
import { ITEMS } from './data.js';
import { INVENTORY_SLOTS } from './config.js';

export function hasSpace(inv, itemId) {
  const def = ITEMS[itemId];
  if (!def) return false;
  const stack = def.stack || 1;
  if (stack > 1 && inv.some((s) => s.item === itemId && s.qty < stack)) return true;
  return inv.length < INVENTORY_SLOTS;
}

// Adiciona qty de um item; empilha quando possível. Retorna true se coube.
export function addItem(inv, itemId, qty = 1) {
  const def = ITEMS[itemId];
  if (!def) return false;
  const stack = def.stack || 1;
  if (stack > 1) {
    const slot = inv.find((s) => s.item === itemId && s.qty < stack);
    if (slot) { slot.qty += qty; return true; }
  }
  if (inv.length >= INVENTORY_SLOTS) return false;
  inv.push({ item: itemId, qty });
  return true;
}

// Consome 1 unidade do slot; remove o slot se zerar.
export function consumeSlot(inv, index) {
  const slot = inv[index];
  if (!slot) return null;
  const itemId = slot.item;
  slot.qty -= 1;
  if (slot.qty <= 0) inv.splice(index, 1);
  return itemId;
}
