# Tales of Axonhood — protótipo (web)

Protótipo jogável de MMORPG com servidor **autoritativo**: mapa com câmera, classes (Guerreiro/Mago),
mobs com IA, combate, XP/level, loot no chão, inventário/equipamento, party, guild, chat e persistência.
É a base de prova de conceito do [documento de arquitetura](../DOCUMENTACAO_INICIAL_MMORPG.md).

## Rodar

```bash
cd prototype
npm install      # só na primeira vez (dependência: ws)
npm start        # sobe em http://localhost:3000
```

Abra **http://localhost:3000**. Para testar multiplayer, abra **outra aba** (cada aba é um herói
diferente — a identidade fica em `sessionStorage`).

## Controles

| Ação | Tecla / Mouse |
|---|---|
| Mover | WASD ou setas |
| Selecionar alvo (atacar mob) | clique no mob |
| Selecionar player (p/ convite) | clique no player |
| Inventário | I |
| Convidar alvo para o grupo | P |
| Sair do grupo | L |
| Guilda (painel) | G |
| Usar poção | Q |
| Chat | Enter (digita), Enter de novo (envia) |

Ataque é **automático** quando o alvo está no alcance (Guerreiro curto/melee, Mago longo/à distância).

## O que está implementado

- **Servidor autoritativo** (tick 30 Hz) — cliente só manda intenção; servidor decide tudo.
- **AOI por grade** — cada player só recebe entidades nas células vizinhas (fog mostra a área).
- **Classes**: Guerreiro (tanque, melee) e Mago (frágil, dano à distância).
- **Combate**: mobs com IA (aggro/perseguir/atacar), dano, morte, **respawn**.
- **Progressão**: XP, level, stats derivados, cura ao subir de nível.
- **Itens**: drops no chão, coleta automática, inventário, equipar/desequipar, poções.
- **Social**: party (com XP dividido entre membros próximos), guilda persistente, chat (global/grupo/guilda).
- **Persistência**: personagem (level, xp, inventário, equip, guilda) salvo em `save/*.json`.

## Deixado para depois (camadas em cima desta base)
Guild war / cerco, arena com matchmaking, trade/leilão, mail, quests/dailies, gacha/loja,
anti-cheat avançado, particionamento por zona. Ver o documento de arquitetura.

## Arquitetura e migração para Unity

A regra de ouro: **toda a lógica vive no servidor**. O cliente é "burro" (manda input, desenha estado).
Por isso, na migração para Unity, **o servidor não muda** — só se troca a camada de apresentação.

```
prototype/
├── server.js              # bootstrap (HTTP + WebSocket + loop de tick)
├── src/                   # SERVIDOR — reaproveitado 100% na migração
│   ├── config.js          # constantes e classes
│   ├── world.js           # mapa, colisão, AOI, spawns
│   ├── data/*.json        # tabelas de itens e mobs (viram ScriptableObjects no Unity)
│   ├── data.js            # carrega as tabelas
│   ├── progression.js     # xp/level/stats
│   ├── inventory.js       # helpers de inventário
│   ├── social.js          # party + guild
│   ├── persistence.js     # save em JSON (vira Postgres/SQLite em produção)
│   └── game.js            # estado + roteamento + tick + AOI (núcleo)
└── public/js/
    ├── net.js    ◄── FRONTEIRA: protocolo. Vira classe C# (WebSocket+JsonUtility) no Unity.
    ├── state.js  ◄── FRONTEIRA: WorldState. Conceito migra para uma classe C#.
    ├── input.js  ✗   descartável — vira Input System + raycast no Unity
    ├── render.js ✗   descartável — vira cenas/prefabs/Sprites no Unity
    ├── ui.js     ✗   descartável — vira uGUI / UI Toolkit no Unity
    └── main.js       cola (vira um GameManager no Unity)
```

### Contrato de protocolo (cliente ⇄ servidor, JSON sobre WebSocket)

**Cliente → servidor:** `hello`, `input`, `target`, `untarget`, `useSlot`, `unequip`,
`party` (invite/accept/leave), `guild` (create/join/leave), `chat`.

**Servidor → cliente:** `init`, `state` (snapshot por AOI), `you` (stats), `inv`, `hit`,
`sys`, `chat`, `party`, `guild`, `invite`, `dead`, `respawn`.

No Unity, cada mensagem vira uma `struct`/classe C# serializável. O conjunto de campos é o
mesmo — é só reimplementar `net.js` e `state.js` em C#, mantendo os nomes.
