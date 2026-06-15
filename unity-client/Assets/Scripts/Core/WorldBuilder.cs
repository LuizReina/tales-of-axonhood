// Constrói o mapa 3D EM RUNTIME a partir do `world` recebido no init (chão, obstáculos,
// cidade/masmorra/arena, portais e NPCs). Assim não há nada de mapa para montar à mão no editor.
using UnityEngine;

namespace Axon
{
    public static class WorldBuilder
    {
        public static void Build(WorldDto w, float scale)
        {
            var root = new GameObject("World").transform;

            // chão
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground"; ground.transform.SetParent(root);
            ground.transform.position = new Vector3(w.width * scale / 2f, 0, w.height * scale / 2f);
            ground.transform.localScale = new Vector3(w.width * scale / 10f, 1, w.height * scale / 10f);
            SetColor(ground, new Color(0.14f, 0.16f, 0.20f));

            // áreas (cidade = verde / masmorra = roxo escuro): quads finos sobre o chão
            if (w.town != null) Area(root, w.town, new Color(0.17f, 0.23f, 0.18f), scale);
            if (w.dungeon != null) Area(root, w.dungeon, new Color(0.23f, 0.13f, 0.19f), scale);

            // obstáculos (cubos)
            foreach (var o in w.obstacles)
            {
                var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                c.transform.SetParent(root);
                c.transform.position = new Vector3((o.x + o.w / 2f) * scale, 1f, (o.y + o.h / 2f) * scale);
                c.transform.localScale = new Vector3(o.w * scale, 2f, o.h * scale);
                SetColor(c, new Color(0.23f, 0.26f, 0.32f));
            }

            // portais (cilindros)
            foreach (var p in w.portals)
            {
                var cyl = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cyl.transform.SetParent(root);
                cyl.transform.position = new Vector3(p.x * scale, 0.2f, p.y * scale);
                cyl.transform.localScale = new Vector3(2.4f, 0.2f, 2.4f);
                SetColor(cyl, ColorUtil.Hex(p.color, Color.magenta));
            }

            // NPCs estáticos (cápsulas) — clicáveis depois (abrir loja/missões nas próximas fatias)
            foreach (var n in w.npcs)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                go.name = "NPC_" + n.name; go.transform.SetParent(root);
                go.transform.position = new Vector3(n.x * scale, 1f, n.y * scale);
                go.transform.localScale = new Vector3(1.6f, 1.6f, 1.6f);
                SetColor(go, ColorUtil.Hex(n.color, Color.white));
                var refc = go.AddComponent<EntityRef>(); refc.kind = "npc"; refc.npcType = n.type;
            }
        }

        static void Area(Transform root, RectDto r, Color col, float scale)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Cube);
            q.transform.SetParent(root);
            q.transform.position = new Vector3((r.x + r.w / 2f) * scale, 0.03f, (r.y + r.h / 2f) * scale);
            q.transform.localScale = new Vector3(r.w * scale, 0.06f, r.h * scale);
            Object.Destroy(q.GetComponent<Collider>()); // decorativo, não bloqueia raycast
            SetColor(q, col);
        }

        static void SetColor(GameObject go, Color c)
        {
            var rend = go.GetComponent<Renderer>();
            if (rend != null) rend.material.color = c;
        }
    }
}
