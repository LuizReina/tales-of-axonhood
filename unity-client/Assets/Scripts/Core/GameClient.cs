// Orquestrador da Fatia 1 — equivalente Unity do main.js do protótipo web.
// Conecta, envia "hello", constrói o mapa no init, sincroniza entidades a cada "state",
// lê o teclado (intenção de movimento), faz clique-para-mirar e move a câmera.
// SETUP: um GameObject vazio com este componente já basta (ver README). Sem prefabs.
using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json.Linq;

namespace Axon
{
    public class GameClient : MonoBehaviour
    {
        [Header("Conexão")]
        public string serverUrl = "ws://localhost:3000";
        public string playerName = "Heroi";
        public string playerClass = "warrior"; // "warrior" ou "mage"

        [Header("Mundo")]
        public float scale = 0.1f; // 1 pixel do servidor = 0.1 unidade Unity

        NetClient net;
        EntityManager em;
        int myId = -1;
        bool worldBuilt;
        bool lUp, lDown, lLeft, lRight; // último input enviado

        void Start()
        {
            string playerId = PlayerPrefs.GetString("axon_pid", "");
            if (string.IsNullOrEmpty(playerId)) { playerId = System.Guid.NewGuid().ToString(); PlayerPrefs.SetString("axon_pid", playerId); }

            em = new EntityManager(scale);
            net = new NetClient();
            net.On("init", OnInit);
            net.On("state", OnState);
            net.OnOpen += () => { Debug.Log("[net] conectado ✓"); net.Hello(playerId, playerName, playerClass); };
            net.OnClose += () => Debug.LogWarning("[net] desconectado");
            Debug.Log("[net] conectando a " + serverUrl);
            net.Connect(serverUrl);
        }

        void OnInit(JObject o)
        {
            myId = (int)o["id"];
            var world = o["world"].ToObject<WorldDto>();
            WorldBuilder.Build(world, scale);
            worldBuilt = true;
            Debug.Log("[net] init recebido — entrou no mundo ✓ (id " + myId + ")");
        }

        void OnState(JObject o)
        {
            var alive = new HashSet<string>();
            foreach (var p in o["players"].ToObject<List<PlayerDto>>())
            {
                string k = "p" + p.id; alive.Add(k);
                em.Upsert(k, "player", p.id, null, p.x, p.y, p.color, 13f);
            }
            foreach (var m in o["mobs"].ToObject<List<MobDto>>())
            {
                string k = "m" + m.id; alive.Add(k);
                em.Upsert(k, "mob", m.id, null, m.x, m.y, m.color, m.radius);
            }
            foreach (var g in o["ground"].ToObject<List<GroundDto>>())
            {
                string k = "g" + g.id; alive.Add(k);
                em.Upsert(k, "ground", g.id, null, g.x, g.y, g.color, 6f);
            }
            em.PruneExcept(alive, "");
        }

        void Update()
        {
            net.Pump();
            if (!worldBuilt) return;

            // movimento (legado Input Manager — ver README sobre Active Input Handling)
            bool up = Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow);
            bool down = Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow);
            bool left = Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow);
            bool right = Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow);
            if (up != lUp || down != lDown || left != lLeft || right != lRight)
            {
                net.Input(up, down, left, right);
                lUp = up; lDown = down; lLeft = left; lRight = right;
            }

            // clique para mirar mob
            if (Input.GetMouseButtonDown(0) && Camera.main != null)
            {
                var ray = Camera.main.ScreenPointToRay(Input.mousePosition);
                if (Physics.Raycast(ray, out var hit, 500f))
                {
                    var er = hit.collider.GetComponent<EntityRef>();
                    if (er != null && er.kind == "mob") net.Target("mob", er.id);
                    else net.Untarget();
                }
                else net.Untarget();
            }

            em.Interpolate(Time.deltaTime);
        }

        void LateUpdate()
        {
            if (myId < 0 || Camera.main == null) return;
            var self = em.Get("p" + myId);
            if (self == null) return;
            var cam = Camera.main.transform;
            Vector3 want = self.position + new Vector3(0f, 16f, -12f);
            cam.position = Vector3.Lerp(cam.position, want, 1f - Mathf.Exp(-8f * Time.deltaTime));
            cam.LookAt(self.position + Vector3.up);
        }

        void OnApplicationQuit() => net?.Close();
    }
}
