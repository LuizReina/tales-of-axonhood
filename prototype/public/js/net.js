// Camada de rede: conexão + (de)serialização + roteamento por tipo de mensagem.
// >>> FRONTEIRA DE MIGRAÇÃO <<< Este é o "contrato" com o servidor. Em Unity, vira uma classe C#
// equivalente (WebSocket + JsonUtility) falando EXATAMENTE o mesmo protocolo. O servidor não muda.
export class Net {
  constructor(url) {
    this.handlers = {};
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      (this.handlers[m.t] || []).forEach((h) => h(m));
    };
    this.ws.onopen = () => (this.handlers.open || []).forEach((h) => h());
    this.ws.onclose = () => (this.handlers.close || []).forEach((h) => h());
  }
  on(type, cb) { (this.handlers[type] ||= []).push(cb); return this; }
  send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  // Atalhos de intenção que o cliente envia (o servidor é quem decide o resultado).
  hello(playerId, name, cls) { this.send({ t: 'hello', playerId, name, cls }); }
  input(keys) { this.send({ t: 'input', ...keys }); }
  target(kind, id) { this.send({ t: 'target', kind, id }); }
  untarget() { this.send({ t: 'untarget' }); }
  useSlot(index) { this.send({ t: 'useSlot', index }); }
  unequip(slot) { this.send({ t: 'unequip', slot }); }
  party(action, id) { this.send({ t: 'party', action, id }); }
  guild(action, name) { this.send({ t: 'guild', action, name }); }
  chat(channel, text) { this.send({ t: 'chat', channel, text }); }
}
