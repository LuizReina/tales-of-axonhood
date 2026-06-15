// Instancia/atualiza/remove as entidades (players, mobs, itens no chão) como PLACEHOLDERS
// primitivos coloridos. Equivalente ao spawn/despawn por AOI do render.js do protótipo web.
// Trocar os primitivos por modelos 3D depois é só mudar o método CreateGo (a lógica não muda).
using System.Collections.Generic;
using UnityEngine;

namespace Axon
{
    public class EntityManager
    {
        class Entry { public Transform tr; public Vector3 target; public Renderer rend; }

        readonly Dictionary<string, Entry> entries = new();
        readonly Transform root;
        readonly float scale;

        public EntityManager(float scale)
        {
            this.scale = scale;
            root = new GameObject("Entities").transform;
        }

        public Transform Get(string key) => entries.TryGetValue(key, out var e) ? e.tr : null;

        Vector3 World(float x, float y, float yUp) => new Vector3(x * scale, yUp, y * scale);

        // Cria (se preciso) e atualiza posição-alvo/cor de uma entidade.
        public void Upsert(string key, string kind, int id, string npcType, float x, float y, string colorHex, float radius)
        {
            if (!entries.TryGetValue(key, out var e))
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                go.name = key;
                go.transform.SetParent(root);
                var refc = go.AddComponent<EntityRef>();
                refc.kind = kind; refc.id = id; refc.npcType = npcType;
                e = new Entry { tr = go.transform, rend = go.GetComponent<Renderer>(), target = World(x, y, 0) };
                e.tr.position = e.target;
                entries[key] = e;
            }
            float r = Mathf.Max(0.5f, radius * scale);
            e.tr.localScale = new Vector3(r * 2f, r, r * 2f);
            e.target = World(x, y, r); // levanta metade da cápsula acima do chão
            if (e.rend != null) e.rend.material.color = ColorUtil.Hex(colorHex, Color.gray);
        }

        // Remove entidades cujas chaves não estão mais presentes (saíram da AOI).
        public void PruneExcept(HashSet<string> alive, string prefix)
        {
            var toRemove = new List<string>();
            foreach (var kv in entries)
                if (kv.Key.StartsWith(prefix) && !alive.Contains(kv.Key)) toRemove.Add(kv.Key);
            foreach (var k in toRemove) { Object.Destroy(entries[k].tr.gameObject); entries.Remove(k); }
        }

        // Suaviza o movimento até a posição-alvo (interpolação).
        public void Interpolate(float dt)
        {
            float t = 1f - Mathf.Exp(-12f * dt);
            foreach (var e in entries.Values)
                e.tr.position = Vector3.Lerp(e.tr.position, e.target, t);
        }
    }
}
