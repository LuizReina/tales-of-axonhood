# Tales of Axonhood

Protótipo de **MMORPG** (estilo *Tales of Wind* / *Magicmon*) com **servidor autoritativo**:
classes (Guerreiro/Mago), combate, mobs com IA, XP/level, loot, inventário/equipamento,
party com XP dividido, guilda (com convite), chat, boss especial e persistência.

> **Versão atual:** v0.2.0

## Jogar localmente

```bash
cd prototype
npm install      # primeira vez (dependência: ws)
npm start        # http://localhost:3000
```

Abra **http://localhost:3000**. Para multiplayer, abra outra aba (cada aba é um herói).

| Ação | Comando |
|---|---|
| Mover | WASD / setas |
| Atacar (mob) | clique no mob |
| Selecionar player | clique no player |
| Inventário · Poção | I · Q |
| Grupo: convidar / sair | P · L |
| Guilda: painel / convidar | G · O |
| Chat | Enter |

**Boss — Phanton HorseFace:** entre pelo portal **"Arena do Boss"** (canto superior direito do mapa).
Ele ataca à distância, nunca mata (deixa você sempre com 1 de HP) e solta frases na tela. Saia pelo portal **"Sair"**.

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
