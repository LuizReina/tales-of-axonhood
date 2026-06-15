# Documentação Inicial — MMORPG Mobile estilo *Tales of Wind: Rebirth* e *Magicmon: World*

> Documento de arquitetura e planejamento técnico para desenvolver um MMORPG mobile multiplayer com conteúdo diário, PvP, guild war e dezenas de jogadores no mesmo mapa.
> **Não cobre** lore, level design ou arte — só o que é necessário para **construir** o jogo.

---

## 0. Os jogos de referência (o que estamos copiando)

### Tales of Wind: Radiant Rebirth
- **Desenvolvedora/Publisher:** Neocraft Limited (Xangai, China).
- **Plataformas:** Android, iOS e PC.
- **Gênero:** MMORPG de ação fantasia, 60 FPS.
- **Pilares:** sistema de evolução dual, *Soul Cards* (cartas/coleção), áreas exploráveis, PvE + PvP pesado, mascotes/asas/montarias, cosméticos.

### Magicmon: World
- **Desenvolvedora:** Magic Network Limited / publisher MWM.
- **Plataformas:** Android, iOS.
- **Gênero:** MMORPG de coleção de monstros (pet/companheiro) + mundo aberto.
- **Pilares:** capturar/treinar/evoluir centenas de "Magicmons", 6 classes de personagem, party co-op, guildas, customização cosmética profunda.

### Padrões comuns aos dois (e o que importa para clonar)
Ambos são **MMORPGs mobile chineses "free-to-play"** com a mesma DNA de produto:
- Mundo persistente com **shards/servidores** ("Server 1, Server 2...") e migração/merge de servidores.
- **Loop diário forte**: missões diárias, dungeons com energia, eventos por horário, login rewards, passe de batalha.
- **Progressão de poder** via equipamentos, refino, pets, asas, montarias, "Soul Cards".
- **Social pesado**: guilda, guild war, chat global/canal, party, casamento, ranking.
- **PvP**: arena 1v1/3v3, campo aberto, eventos de massa (cross-server).
- **Monetização**: gacha/sorteio, pacotes, VIP, moeda premium, cosméticos, passe.
- **Engine de cliente** quase sempre **Unity** (ocasionalmente Cocos2d-x/Unreal). Servidor de jogo **autoritativo** customizado (não usam Photon/PlayFab puro porque não escalam para MMO de mundo aberto).

> **Premissa-chave:** não existe solução "pronta" (Photon, UGS, PlayFab, GameLift) que entregue MMO de mundo aberto com dezenas/centenas de players no mesmo mapa. Essas plataformas são feitas para jogos **session-based**. O coração de um MMO é um **servidor de jogo autoritativo, espacialmente particionado, com Area of Interest (AOI)** — isso você **constrói**.

---

## 1. Decisões de stack (resumo executivo)

| Camada | Escolha recomendada | Alternativas |
|---|---|---|
| **Cliente / Engine** | **Unity** (LTS) + C# | Unreal Engine 5; Cocos2d-x |
| **Render alvo** | 60 FPS, URP (Universal Render Pipeline), suporte a low-end Android | — |
| **Protocolo de rede** | **TCP** (gameplay confiável) + **UDP/KCP** (movimento) | WebSocket; ENet; QUIC |
| **Serialização** | **Protobuf** (ou FlatBuffers) | MessagePack; JSON (só p/ debug) |
| **Game server (autoritativo)** | **C#/.NET**, **Go**, **C++** ou **Erlang/Elixir** | Rust; Java/Netty |
| **Lógica/Scripting de conteúdo** | Lua / C# hot-reload | — |
| **Banco persistente** | **PostgreSQL** ou **MySQL** (dados de conta/inventário) | — |
| **Cache / estado em tempo real** | **Redis** (sessão, ranking, locks, AOI auxiliar) | — |
| **Mensageria entre serviços** | **NATS** / **Kafka** | RabbitMQ |
| **Banco analítico/log** | ClickHouse / BigQuery | — |
| **Infra** | **Kubernetes** + autoscaling, multi-região | bare metal para game nodes |
| **Pagamentos** | **Google Play Billing** + **Apple StoreKit** (obrigatório no mobile) | Stripe/PayPal só no PC/web |

> **Recomendação pragmática para você (1 dev / time pequeno):** Unity + servidor em **C#/.NET** (mesma linguagem dos dois lados reduz custo cognitivo) ou **Go** (concorrência mais simples para milhares de conexões). Comece com **um único processo de servidor de mundo** e só parta para particionamento distribuído quando a carga exigir.

---

## 2. Cliente (Unity)

### 2.1 Por que Unity
- É o que esse gênero usa na prática (build Android+iOS+PC com um código).
- Asset pipeline maduro, Addressables para download de conteúdo, suporte a low-end.
- Ecossistema de C# compartilhável com servidor .NET (DTOs, fórmulas de dano, validação preditiva).

### 2.2 Estrutura do projeto cliente
```
/Client
  /Core         -> networking, serialização, gerenciador de cena, pooling
  /Gameplay     -> movimento, combate, skills, AOI local (spawn/despawn de entidades)
  /UI           -> UGUI/UI Toolkit; HUD, inventário, loja, guild
  /Net          -> conexão, reconnect, fila de pacotes, predição
  /Data         -> tabelas de config (ScriptableObject/CSV/JSON exportado do servidor)
  /Addressables -> assets baixados sob demanda (mapas, mobs, cosméticos)
```

### 2.3 Tópicos críticos de cliente
- **Client-side prediction + server reconciliation**: o cliente prevê movimento/skill localmente e corrige com o estado autoritativo. Sem isso, com dezenas de players, o jogo "borracha".
- **Interpolação de entidades remotas** (buffer de ~100ms) para movimento suave.
- **AOI local**: instanciar só entidades dentro da área de interesse que o servidor envia; pool de objetos para evitar GC spikes.
- **LOD agressivo e culling** para "dezenas de players no mesmo mapa" (impostors, redução de animação/partículas em multidão — ex.: guild war com 50+ players).
- **Addressables / download incremental**: APK base leve; conteúdo (mapas, mobs) baixado por demanda.
- **Reconnect resiliente**: rede mobile cai o tempo todo; sessão precisa sobreviver a troca Wi-Fi↔4G.
- **Configuração orientada a dados**: stats, skills, drops, preços vêm de **tabelas versionadas no servidor**, não hardcoded — permite balancear sem novo build.

---

## 3. Arquitetura de servidores (o coração do MMO)

### 3.1 Modelo de servidor autoritativo
O servidor é a **fonte da verdade**. Cliente envia *intenções* ("quero andar para X", "usar skill Y no alvo Z"); o servidor valida, resolve e transmite resultados. Nunca confie no cliente para dano, posição final, drops ou moeda.

### 3.2 Serviços (microserviços / processos lógicos)

```
                    ┌─────────────┐
   Cliente ──TLS──► │  Gateway     │  (auth de sessão, balanceamento, anti-DDoS,
                    │  / Connector │   tradução de protocolo, rate limit)
                    └──────┬──────┘
                           │
        ┌──────────────────┼─────────────────────────────┐
        ▼                  ▼                              ▼
  ┌───────────┐     ┌──────────────┐              ┌──────────────┐
  │ Auth/      │    │ World Servers │              │ Serviços      │
  │ Account    │    │ (Game Nodes)  │              │ globais       │
  │ Service    │    │ por zona/AOI  │              │ - Chat        │
  └─────┬─────┘     └──────┬───────┘               │ - Guild       │
        │                  │                       │ - Mail        │
        ▼                  ▼                       │ - Ranking     │
  ┌───────────┐     ┌──────────────┐               │ - Matchmaking │
  │ Postgres  │     │ Redis (estado │               │ - Trade/Loja │
  │ (conta,   │     │ quente, AOI,  │               │ - Pagamentos │
  │ inventário)│    │ locks, rank)  │               └──────────────┘
  └───────────┘     └──────────────┘
        │                  │                              │
        └────────► NATS/Kafka (eventos entre serviços) ◄──┘
```

**Papéis:**
- **Gateway/Connector**: mantém as conexões persistentes (TCP/WebSocket/KCP), faz TLS, rate-limit, e roteia pacotes ao world server certo. Permite trocar o jogador de world server sem derrubar a conexão.
- **Auth/Account**: login, tokens de sessão, ban, vínculo de plataforma.
- **World Server (Game Node)**: roda a simulação de uma **zona/mapa** (ou pedaço dele). Tick fixo (ex.: 10–30 Hz). Gerencia entidades, combate, IA de mobs, AOI, loot.
- **Serviços globais (cross-zone/cross-server)**: chat, guilda, mail, ranking, matchmaking de arena, leilão/trade, eventos cross-server.

### 3.3 Tick loop do world server
```
loop a cada 1/TICK_RATE segundos:
  1. processar pacotes de entrada (intenções dos jogadores)
  2. atualizar IA de mobs / NPCs
  3. resolver física simplificada / colisão / movimento
  4. resolver combate (dano, buffs, morte, drops)
  5. atualizar AOI (quem vê quem)
  6. montar e enviar snapshots delta para cada jogador (só o que está no AOI dele)
  7. persistir mudanças críticas (async, via fila)
```
- **Tick rate**: 10–15 Hz costuma bastar para MMORPG (vs. 60+ Hz de FPS competitivo). Combate por *target/skill* tolera menos frequência que mira livre.
- **Snapshots delta + AOI**: só envie o que mudou e só o que o jogador "enxerga". Isso é o que torna possível "dezenas no mesmo mapa".

### 3.4 Area of Interest (AOI) — o algoritmo central
AOI determina quais entidades são relevantes para cada jogador (eventos de entrada/saída disparam spawn/despawn no cliente). Implementações comuns:
- **Grid/Tile buckets**: divide o mapa em células; jogador "vê" sua célula + vizinhas. Simples, rápido, é o padrão da indústria para mobile MMO.
- **Cross-link / linked list (algoritmo "9-grid")**: atualiza vizinhança ao mover.
- **Quadtree**: melhor para densidade irregular.
- **Limite de entidades enviadas**: em multidão (guild war), aplicar *cap* de quantos players são sincronizados em detalhe + priorização (mais próximos / no seu grupo / inimigos).

### 3.5 Particionamento / Sharding (escalar o mundo)
- **Sharding por servidor ("realms")**: "Server 1, Server 2..." — cada um é um mundo independente. É como ToW/Magicmon escalam de fato e simplifica MUITO (cada shard tem seu próprio banco lógico). **Comece por aqui.**
- **Sharding por zona (area-based)**: cada mapa/zona em um game node; jogador "viaja" entre nodes (handoff). Necessário quando uma única zona tem muita gente.
- **Instâncias dinâmicas**: dungeons, arenas e raids são instâncias efêmeras criadas sob demanda (Kubernetes Job/Pod ou processo) e destruídas no fim.
- **Cross-server**: para PvP de massa e ranking global, serviços globais agregam vários shards (ex.: guild war cross-server, arena mundial).
- **Server merge**: quando shards esvaziam, mesclar dados — planejar **desde o schema** (IDs globais, dedup de nomes).

### 3.6 Eventos de massa (Guild War / dezenas no mesmo mapa)
- Usar **instância dedicada** para o evento (não o mapa aberto): pod isolado, recursos garantidos.
- **AOI + cap de visão** agressivo; agrupar players distantes em representação simplificada.
- **Tick possivelmente menor** durante massa, com interpolação compensando no cliente.
- **Combate por target** (não hitbox livre) reduz custo de física.
- **Pré-alocação** de instância antes do horário do evento (evita cold start).
- Considerar **partição espacial dentro da instância** se passar de ~100 players.

---

## 4. Banco de dados

### 4.1 Camadas de dados
| Tipo de dado | Onde | Por quê |
|---|---|---|
| Conta, login, billing, ban | **PostgreSQL/MySQL** (ACID) | consistência forte, dinheiro/posse |
| Personagem, inventário, equip, pets | **PostgreSQL/MySQL** por shard | transacional, auditável |
| Estado em tempo real (posição, sessão, cooldowns) | **Redis** | volátil, latência baixa, não precisa durar |
| Ranking / leaderboard | **Redis Sorted Sets** | ordenação O(log n) nativa |
| Locks distribuídos / idempotência | **Redis** | evitar dupe de item/moeda |
| Chat history, mail | Redis + Postgres / Cassandra | volume alto, TTL |
| Logs, métricas de jogo, economia | **ClickHouse / BigQuery** | analytics, anti-fraude, balanceamento |

### 4.2 Padrões obrigatórios
- **Servidor escreve, nunca o cliente.** Toda mutação de inventário/moeda passa por transação no servidor.
- **Write-back assíncrono**: world server mantém estado em memória + Redis, e persiste no SQL em lotes/async (fila) para não travar o tick. Cuidado com perda em crash → snapshot periódico + log de eventos.
- **Idempotência e transações** em qualquer coisa que envolva dinheiro/itens (compra, trade, gacha) — usar locks e *idempotency keys* para evitar duplicação.
- **Sharding de DB**: cada "Server N" do jogo = um schema/instância. Facilita escala e merge.
- **Backups + PITR** (point-in-time recovery) — dado de jogador é sagrado; rollback errado gera revolta e chargeback.
- **Auditoria/economia**: logar toda criação/destruição de moeda e item premium (essencial para detectar exploits e duping).

---

## 5. Sistema de pagamentos

### 5.1 Regras de plataforma (não negociável)
- **Mobile**: compras de bens digitais **DEVEM** usar **Google Play Billing** (Android) e **Apple StoreKit / In-App Purchase** (iOS). Stripe/PayPal para bens digitais no app são **proibidos** pelas lojas e levam a remoção. Comissão padrão ~15–30%.
- **PC/Web**: aí sim Stripe/PayPal/Pix são possíveis (e webshop fora da loja é como muitos jogos chineses reduzem a taxa).

### 5.2 Fluxo seguro de compra (server-side validation)
```
1. Cliente inicia compra na loja (Google/Apple) → recebe recibo/token.
2. Cliente envia recibo ao SEU servidor de pagamentos.
3. Servidor VALIDA o recibo direto com Google/Apple (server-to-server).
4. Se válido e não consumido → credita itens/moeda (transação idempotente).
5. Marca recibo como consumido (anti-replay) + loga na auditoria.
6. Trata webhooks de reembolso/chargeback → revoga itens, possível ban.
```
- **Nunca** credite item baseado só no "ok" do cliente. Sempre validação servidor↔loja.
- **Idempotência por order_id** (não creditar duas vezes em retry).
- **Reembolsos/chargeback**: webhook do Google/Apple → reconciliar saldo, anti-abuso.
- **Moeda premium vs. ganha**: separar contabilmente (afeta reembolso, regulação de "loot box"/gacha em alguns países).
- **Compliance**: muitos países exigem **divulgação de probabilidade de gacha**; alguns restringem loot box para menores. Planejar painel de "drop rates".

### 5.3 Itens monetizáveis típicos do gênero
VIP/assinatura, passe de batalha, pacotes de moeda, gacha (sorteio de pets/equip/cosmético), cosméticos (asas, montarias, skins), conveniências (energia, slots), eventos de recarga.

---

## 6. Performance

### 6.1 Cliente
- **60 FPS alvo**, mas escalonável: qualidade dinâmica por device tier.
- **Object pooling** (sem instanciar/destruir em combate → sem GC spikes).
- **Multidão**: cap de players renderizados em detalhe, animação/partícula reduzida ao longe, GPU instancing, atlas de textura.
- **Addressables/streaming** para não estourar memória em low-end Android.
- **Bateria/aquecimento**: limitar FPS em telas de menu, evitar polling agressivo.

### 6.2 Rede
- **Snapshots delta + AOI** (já citado) — o maior ganho.
- **Compressão**: Protobuf/FlatBuffers + quantização de posição (não mande float64 de coordenada).
- **Batching de pacotes** por tick; **prioridade** (movimento de inimigo próximo > player distante).
- **TCP para confiável, UDP/KCP para movimento** (KCP dá confiabilidade sobre UDP com baixa latência — popular em jogos mobile chineses).
- **Reconnect + resync de estado** rápido.

### 6.3 Servidor
- **Tick budget**: cada tick precisa caber no orçamento de tempo (ex.: 66ms p/ 15Hz). Profile constante.
- **Single-thread por zona + sharding** costuma ser mais simples e previsível que locking multi-thread numa zona.
- **Estado quente em memória**, persistência assíncrona.
- **Limitar entidades por zona**; spillover para instâncias.
- **Load test** com bots simulando milhares de conexões antes de lançar.

---

## 7. Segurança e anti-cheat
- **Servidor autoritativo** já elimina a maioria dos cheats (speed/teleport/dano).
- **Validação de sanidade**: velocidade máxima, cooldown de skill, alcance, taxa de ações (anti-bot).
- **TLS** em tudo; tokens de sessão de curta duração; assinatura de pacotes sensíveis.
- **Rate limiting** no gateway (anti-DDoS, anti-flood de chat).
- **Detecção de bot/farm**: heurística + analytics (padrões de movimento, cliques).
- **Anti-tamper no cliente** (ofuscação, integridade), sabendo que cliente nunca é confiável.
- **Auditoria de economia** para pegar duping/exploit cedo.
- **LGPD/GDPR**: consentimento, direito ao apagamento, dados de menores, armazenamento regional.

---

## 8. Infra, DevOps e operação
- **Kubernetes** para serviços stateless (gateway, auth, chat, pagamentos) e **instâncias dinâmicas** (dungeons, eventos) via Jobs/Pods.
- **Game nodes (world)**: stateful — usar StatefulSet ou orquestração de fleet (ex.: Agones, Edgegap, ou fleet manager próprio) com matchmaking/placement.
- **Multi-região** (latência): servidores por região (NA/EU/SEA/BR...). Players escolhem shard.
- **Autoscaling** por carga (CCU) — subir instâncias de zona/evento sob demanda; pré-aquecer antes de horários de pico/evento.
- **CI/CD**: build de cliente (Unity Cloud Build/Fastlane) + deploy de servidor (containers). Versionamento de protocolo (compatibilidade cliente↔servidor).
- **Hot config / live ops**: tabelas de balanceamento, drop rates, preços e eventos atualizáveis **sem novo build** (essencial para o loop diário).
- **Observabilidade**: métricas (Prometheus/Grafana), tracing, logs centralizados, alertas de tick lag/queda de node.
- **Live ops**: ferramentas de GM (banir, reembolsar, spawn, compensar mail em massa), painel de economia, agendador de eventos.

---

## 9. Sistemas de gameplay a implementar (checklist do gênero)

### Núcleo
- [ ] Movimento autoritativo + predição/reconciliação
- [ ] Combate (target/skill, buffs/debuffs, dano, morte, ressurreição)
- [ ] Sistema de skills/cooldowns/recursos (mana/energia)
- [ ] Stats e fórmulas de poder (data-driven)
- [ ] Inventário, equipamento, refino/upgrade, sockets
- [ ] Loot/drop e tabelas de recompensa server-side
- [ ] Sistema de pets/companheiros (coleta, evolução, skills) — *core do Magicmon*
- [ ] Asas/montarias/cosméticos
- [ ] Quests (main, side, **diárias**, semanais)
- [ ] Dungeons/instâncias com energia
- [ ] Sistema de "cartas"/coleção (Soul Cards — *ToW*)

### Social
- [ ] Chat (global, canal, guild, party, privado) — serviço dedicado
- [ ] Party/grupo e co-op
- [ ] Guildas (criar, cargos, contribuição, tech/buffs)
- [ ] **Guild War** (instância de massa, objetivos, scoring)
- [ ] Mail (com anexos de item/moeda)
- [ ] Amigos, casamento, ranking/leaderboards
- [ ] Trade/leilão/marketplace (com travas anti-dupe)

### PvP
- [ ] Arena 1v1 / 3v3 (matchmaking)
- [ ] PvP de campo aberto (flag/karma)
- [ ] Eventos PvP de massa / cross-server
- [ ] Rankings de temporada

### Economia / LiveOps / Monetização
- [ ] Moeda dupla (premium / ganha) com contabilidade separada
- [ ] Loja + IAP validado server-side
- [ ] Gacha/sorteio com drop rates configuráveis e divulgados
- [ ] Passe de batalha / VIP / assinatura
- [ ] Login diário, eventos por horário, missões diárias/semanais
- [ ] Mail de compensação em massa (GM)

---

## 10. Roadmap sugerido (MVP → escala)

**Fase 0 — Prova de conceito (1 mapa, 1 servidor):**
Unity client + 1 world server (.NET ou Go) single-process. Movimento autoritativo + AOI por grid + ver outros players se mexendo. Login básico. PostgreSQL + Redis. **Meta:** 20–50 players no mesmo mapa, sem cheats triviais.

**Fase 1 — Loop de jogo:**
Combate, skills, mobs/IA, inventário, loot, quests diárias, 1 dungeon instanciada. Chat. Persistência confiável.

**Fase 2 — Social + monetização:**
Guildas, party, mail, ranking (Redis). IAP validado (Google/Apple). Loja + gacha. Passe diário.

**Fase 3 — PvP + escala:**
Arena com matchmaking, guild war instanciada, sharding por servidor ("Server 1/2..."), múltiplas regiões, autoscaling, ferramentas de GM/liveops.

**Fase 4 — Cross-server + polish:**
Eventos cross-server, server merge, anti-cheat avançado, otimização de multidão, analytics de economia.

---

## 11. Riscos e armadilhas conhecidas
- **Subestimar o servidor**: a engine de cliente é a parte fácil; o MMO autoritativo escalável é onde o projeto vive ou morre.
- **Confiar no cliente**: qualquer cálculo de dano/moeda/drop no cliente = exploit garantido.
- **Persistência síncrona no tick**: trava o mundo; sempre async com cuidado contra perda em crash.
- **Pagamento sem validação server-side**: fraude e itens grátis.
- **Não planejar server merge / IDs globais desde o schema**: dor enorme depois.
- **Multidão sem AOI/cap**: guild war derruba o servidor e o FPS do cliente.
- **Ignorar regras das lojas**: app removido por usar pagamento fora do IAP.
- **Escopo**: esses jogos têm centenas de sistemas e times grandes. Para um time pequeno, **corte impiedosamente** o MVP.

---

## 12. Referências
- [Tales of Wind: Radiant Rebirth — Google Play](https://play.google.com/store/apps/details?id=com.emagroups.tow&hl=en_US)
- [Neocraft lança Tales of Wind: Radiant Rebirth — GamingOnPhone](https://gamingonphone.com/news/neocrafts-latest-mmorpg-tales-of-wind-radiant-rebirth-is-now-available-on-mobile-and-pc/)
- [Magicmon: World — App Store](https://apps.apple.com/us/app/magicmon-world/id6752015542)
- [Magicmon: World lançamento global — Pocket Gamer](https://www.pocketgamer.com/magicmon/global-launch/)
- [MMO Architecture: Area-Based Sharding — PRDeving](https://prdeving.wordpress.com/2025/05/12/mmo-architecture-area-based-sharding-shared-state-and-the-art-of-herding-digital-cats/)
- [MMO Architecture: Source of truth, Dataflows, I/O bottlenecks — PRDeving](https://prdeving.wordpress.com/2023/09/29/mmo-architecture-source-of-truth-dataflows-i-o-bottlenecks-and-how-to-solve-them/)
- [MMO Online Game AOI Algorithm — DEV Community](https://dev.to/aceld/11-mmo-online-game-aoi-algorithm-l7d)
- [How MMO Games' Architecture Scales — Edgegap](https://edgegap.com/blog/how-mmo-games-architecture-scales-with-a-smart-fleet-manager)
- [MobileMMORPG (exemplo .NET + Unity) — GitHub](https://github.com/Ziden/MobileMMORPG)
- [Unity MMO Framework (TCP/UDP) — GitHub](https://github.com/HectorPulido/Unity-MMO-Framework)

> *Documento inicial — vivo. Atualize conforme decisões de stack forem fechadas.*
