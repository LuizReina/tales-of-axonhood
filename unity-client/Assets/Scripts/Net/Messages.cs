// DTOs do protocolo (espelham as mensagens JSON do servidor Node).
// Newtonsoft faz o match de nomes ignorando maiúsc/minúsc, então os campos batem com o JSON.
using System.Collections.Generic;
using UnityEngine;

namespace Axon
{
    [System.Serializable] public class RectDto { public float x, y, w, h; }
    [System.Serializable] public class PortalDto { public int id; public float x, y, tx, ty; public string label, color, cost; }
    [System.Serializable] public class NpcDto { public string id, type, name, role, color; public float x, y; }

    [System.Serializable]
    public class WorldDto
    {
        public float width, height;
        public List<RectDto> obstacles = new();
        public RectDto town;
        public RectDto dungeon;
        public List<PortalDto> portals = new();
        public List<NpcDto> npcs = new();
    }

    [System.Serializable]
    public class PlayerDto
    {
        public int id; public string name, cls, color, petColor;
        public float x, y; public int hp, maxHp, level; public bool dead, mounted;
    }

    [System.Serializable]
    public class MobDto
    {
        public int id; public string kind, name, color, say;
        public float x, y, radius; public int hp, maxHp; public bool boss;
    }

    [System.Serializable]
    public class GroundDto { public int id; public string item, name, color; public float x, y; }

    // util: "#rrggbb" -> Color
    public static class ColorUtil
    {
        public static Color Hex(string hex, Color fallback)
        {
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out var c)) return c;
            return fallback;
        }
    }
}
