// Camada de rede: conexão + (de)serialização + roteamento por tipo de mensagem.
// >>> FRONTEIRA DE MIGRAÇÃO <<< Este é o "contrato" com o servidor. Em Unity, vira uma classe C#
// equivalente (WebSocket + JsonUtility) falando EXATAMENTE o mesmo protocolo. O servidor não muda.
export class Net {
  constructor(url) {
    this.handlers = {};
    console.log('[net] abrindo WebSocket:', url);
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { console.error('[net] mensagem inválida:', e.data); return; }
      console.debug('[net] <-', m.t);
      (this.handlers[m.t] || []).forEach((h) => {
        try { h(m); } catch (err) { console.error(`[net] erro no handler "${m.t}":`, err); }
      });
    };
    this.ws.onopen = () => { console.log('[net] conectado ✓'); (this.handlers.open || []).forEach((h) => h()); };
    this.ws.onclose = (e) => { console.warn('[net] fechado (code', e.code + ')'); (this.handlers.close || []).forEach((h) => h()); };
    this.ws.onerror = () => console.error('[net] erro de WebSocket (servidor no ar? porta certa?)');
  }
  on(type, cb) { (this.handlers[type] ||= []).push(cb); return this; }
  send(obj) {
    if (this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); console.debug('[net] ->', obj.t); }
    else console.warn('[net] tentou enviar', obj.t, 'com socket não-aberto (readyState', this.ws.readyState + ')');
  }

  // Atalhos de intenção que o cliente envia (o servidor é quem decide o resultado).
  hello(playerId, name, cls) { this.send({ t: 'hello', playerId, name, cls }); }
  input(keys) { this.send({ t: 'input', ...keys }); }
  target(kind, id) { this.send({ t: 'target', kind, id }); }
  untarget() { this.send({ t: 'untarget' }); }
  skill(id) { this.send({ t: 'skill', id }); }
  useSlot(index) { this.send({ t: 'useSlot', index }); }
  unequip(slot) { this.send({ t: 'unequip', slot }); }
  party(action, id) { this.send({ t: 'party', action, id }); }
  guild(action, name) { this.send({ t: 'guild', action, name }); }
  chat(channel, text) { this.send({ t: 'chat', channel, text }); }
  quest(action, id) { this.send({ t: 'quest', action, id }); }
  shop(action, arg) { this.send({ t: 'shop', action, ...arg }); }
  refine(slot) { this.send({ t: 'refine', slot }); }
  pet(action, id) { this.send({ t: 'pet', action, id }); }
  mount(action, id) { this.send({ t: 'mount', action, id }); }
  duel(action, id) { this.send({ t: 'duel', action, id }); }
  marry(action, id) { this.send({ t: 'marry', action, id }); }
  rank() { this.send({ t: 'rank' }); }
}
