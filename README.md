# Tales of Axonhood

Protótipo de **MMORPG** (estilo *Tales of Wind* / *Magicmon*) com **servidor autoritativo**.

> **Versão atual:** v1.0.0

## Jogar localmente

```bash
cd prototype
npm install      # primeira vez (dependência: ws)
npm start        # http://localhost:3000
```

Abra **http://localhost:3000**. Para multiplayer, abra outra aba (cada aba é um herói).

## Sistemas implementados

- **Cidade inicial**: área segura onde você nasce e os NPCs ficam (monstros não entram).
- **Classes em cadeia** (evoluem por nível): Guerreiro→Cavaleiro→Senhor da Guerra · Mago→Feiticeiro→Arquimago.
- **Skills ativas** desbloqueadas por nível (hotbar 1–4); combate com mobs (IA), morte/respawn.
- **XP/level**, **Ouro**, **inventário/equipamento**, loot no chão.
- **Quests** principais (cadeia) e **diárias**; **Loja** (NPC), **check-in diário**.
- **Refino** de equipamento (NPC Ferreiro), **Pets** (bônus) e **Montarias** (velocidade) — NPC Domadora.
- **Party** (XP dividido), **Guilda** (com convite), **Chat** (global/grupo/guilda).
- **Duelo PvP**, **Ranking de poder**, **Casamento** (+5% HP).
- **Boss** Phanton HorseFace (arena por portal), **Masmorra** com energia diária e mini-boss, **Evento mundial** (invasão periódica).
- **Persistência** do personagem e **AOI** (só recebe quem está perto).

## Controles

| Ação | Comando |
|---|---|
| Mover | WASD / setas |
| Atacar mob / selecionar player / falar com NPC | clique |
| Skills | 1 – 4 |
| Missões · Inventário · Poção | J · I · Q |
| Montar/desmontar · Ranking | H · K |
| Duelo · Casar (no player selecionado) | T · M |
| Grupo: convidar / sair | P · L |
| Guilda: painel / convidar | G · O |
| Chat | Enter |

**Boss / Masmorra:** use os **portais** no mapa. A arena do boss fica no canto superior direito; a masmorra
custa 1 de energia (reseta por dia) e tem um mini-boss. Um **evento de invasão** ocorre periodicamente no campo central.

## GitHub Pages (cliente publicado)

O cliente estático é publicado pelo Pages a partir da pasta [`/docs`](docs). **Importante:** o Pages
serve só arquivos estáticos — **ele não roda o servidor**. Para jogar de verdade você precisa de um
servidor WebSocket no ar:

- **Local:** rode `npm start` (acima) e jogue em `http://localhost:3000`.
- **Pela página do Pages:** informe um servidor hospedado com TLS via query string —
  `…github.io/tales-of-axonhood/?server=wss://SEU-SERVIDOR`. Sem isso, a tela carrega mas avisa que
  não há servidor para conectar.

Para hospedar o servidor (e ter `wss://`), use um PaaS de Node como Render, Railway ou Fly.io
rodando `prototype/`.

## Estrutura

```
docs/            # cliente estático (publicado no GitHub Pages; servido também pelo servidor local)
prototype/       # servidor Node.js autoritativo (a lógica do jogo)
  server.js      # bootstrap (HTTP + WebSocket + tick); serve ../docs
  src/           # config, world, data, progressão, inventário, social, persistência, game (núcleo)
DOCUMENTACAO_INICIAL_MMORPG.md   # documento de arquitetura (servidores, BD, pagamentos, AOI…)
prototype/README.md              # detalhes técnicos e plano de migração para Unity
```

## Princípio de arquitetura
Toda a regra de jogo vive **no servidor** (cliente só envia intenção e desenha). Isso mantém o jogo
à prova de cheat e facilita a futura migração para Unity: o servidor não muda — só se reescreve a
camada de apresentação (`docs/js/render.js` e `ui.js`). Detalhes em [`prototype/README.md`](prototype/README.md).
