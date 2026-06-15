// Camada de rede do cliente Unity — equivalente C# do net.js do protótipo web.
// >>> Fala EXATAMENTE o mesmo protocolo WebSocket+JSON do servidor Node (que não muda). <<<
// Requer os pacotes: NativeWebSocket e Newtonsoft.Json (ver README).
using System;
using System.Collections.Generic;
using System.Text;
using NativeWebSocket;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Axon
{
    public class NetClient
    {
        WebSocket ws;
        readonly Dictionary<string, Action<JObject>> handlers = new();
        public Action OnOpen, OnClose;

        public void On(string type, Action<JObject> handler) => handlers[type] = handler;

        public async void Connect(string url)
        {
            ws = new WebSocket(url);
            ws.OnOpen += () => OnOpen?.Invoke();
            ws.OnClose += (e) => OnClose?.Invoke();
            ws.OnError += (e) => UnityEngine.Debug.LogWarning("[net] erro WS: " + e);
            ws.OnMessage += (bytes) =>
            {
                var json = Encoding.UTF8.GetString(bytes);
                JObject o;
                try { o = JObject.Parse(json); } catch { return; }
                var t = o["t"]?.ToString();
                if (t != null && handlers.TryGetValue(t, out var h)) h(o);
            };
            await ws.Connect();
        }

        // Deve ser chamado todo frame (entrega as mensagens na main thread; exceto WebGL).
        public void Pump()
        {
#if !UNITY_WEBGL || UNITY_EDITOR
            ws?.DispatchMessageQueue();
#endif
        }

        public async void Send(object payload)
        {
            if (ws != null && ws.State == WebSocketState.Open)
                await ws.SendText(JsonConvert.SerializeObject(payload));
        }

        // Atalhos de intenção (o servidor decide o resultado).
        public void Hello(string playerId, string name, string cls) => Send(new { t = "hello", playerId, name, cls });
        public void Input(bool up, bool down, bool left, bool right) => Send(new { t = "input", up, down, left, right });
        public void Target(string kind, int id) => Send(new { t = "target", kind, id });
        public void Untarget() => Send(new { t = "untarget" });

        public async void Close() { if (ws != null) await ws.Close(); }
    }
}
