// Marcador colado em cada GameObject de entidade, para identificar o que foi clicado (raycast).
using UnityEngine;

namespace Axon
{
    public class EntityRef : MonoBehaviour
    {
        public string kind;     // "player" | "mob" | "npc"
        public int id;          // id do servidor (player/mob)
        public string npcType;  // "shop"/"quest"/... quando kind == "npc"
    }
}
