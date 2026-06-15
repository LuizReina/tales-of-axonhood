# Cliente Unity — Tales of Axonhood (migração 3D)

Cliente Unity que fala o **mesmo protocolo** do servidor Node do protótipo (em `../prototype`).
O servidor **não muda** — este cliente é a nova "cara" 3D.

> **Status: Fatia 1** — conectar, construir o mapa 3D em runtime, ver as entidades (placeholders),
> andar (WASD) e clicar para mirar um mob. HUD, painéis, login e troca por modelos 3D vêm nas próximas fatias.

## Pré-requisitos
- **Unity 6 LTS** (ou 2022.3 LTS) com o módulo **Android Build Support** (instale pelo Unity Hub).
- O servidor Node rodando: `cd ../prototype && npm install && npm start` (fica em `ws://localhost:3000`).

## Passo a passo (setup do projeto)

1. **Criar projeto**: Unity Hub → New Project → template **3D (Built-In Render Pipeline)** ("3D Core"). _(URP também funciona, mas o Built-In evita surpresas de material.)_

2. **Instalar os 2 pacotes** (Window → Package Manager → botão **+**):
   - "Add package by name…" → `com.unity.nuget.newtonsoft-json`
   - "Add package from git URL…" → `https://github.com/endel/NativeWebSocket.git#upm`

3. **Copiar os scripts**: copie a pasta `Assets/Scripts` deste diretório para dentro de `Assets/` do seu projeto Unity.

4. **Input legado**: Project Settings → Player → **Active Input Handling = Both** (a Fatia 1 usa o Input Manager clássico).

5. **Cena**: na cena padrão (já tem _Main Camera_ e _Directional Light_):
   - Crie um GameObject vazio (`GameObject → Create Empty`), nomeie **Game**.
   - Adicione o componente **GameClient** (Add Component → procure "GameClient").
   - No Inspector: `Server Url` = `ws://localhost:3000`; `Player Name` = seu nome; `Player Class` = `warrior` ou `mage`.

6. **Rodar**: com o servidor Node no ar, aperte **Play**.

### O que você deve ver
- Console: `[net] conectando…` → `[net] conectado ✓` → `init recebido — entrou no mundo ✓`.
- Um mapa 3D montado sozinho: chão, paredes (cubos), **cidade** (verde) e **masmorra** (roxo), **portais** (cilindros) e **NPCs** (cápsulas).
- Sua cápsula + outras entidades; **WASD** move (o servidor é autoritativo); **clique** numa cápsula de mob a seleciona (auto-ataque do servidor).
- Abra outra instância (ou o cliente web) pra ver multiplayer no mesmo mundo.

## Build Android (quando quiser testar no celular)
1. Project Settings → Player: defina Company/Product Name e o Package Name.
2. File → Build Settings → Platform **Android** → Switch Platform.
3. **Importante:** o celular não enxerga `localhost`. Use o **IP da máquina** que roda o servidor na mesma rede: `ws://192.168.x.x:3000` (ajuste `Server Url`). Para internet/produção, hospede o servidor com TLS e use `wss://…`.
4. Build And Run com o celular conectado (modo desenvolvedor + depuração USB).

## Estrutura
```
Assets/Scripts/
├── Net/
│   ├── NetClient.cs   # WebSocket + JSON (espelha net.js) — fala o protocolo do servidor
│   └── Messages.cs    # DTOs das mensagens (world, player, mob, ground…)
└── Core/
    ├── GameClient.cs    # orquestrador (init→mapa, state→entidades, input, câmera)
    ├── WorldBuilder.cs  # monta o mapa 3D em runtime a partir do init
    ├── EntityManager.cs # spawn/despawn/interpolação das entidades (placeholders)
    └── EntityRef.cs     # marcador p/ clique (raycast)
```

## Próximas fatias
2. HUD (vida/xp/ouro/energia) + hotbar de skills (UI Toolkit).
3. Painéis: inventário, loja, missões, ferreiro, domadora, ranking, chat + tela de login.
4. Trocar placeholders por modelos 3D + animações; câmera/efeitos; polish mobile.

## Problemas comuns
- **Erros de compilação citando `NativeWebSocket` ou `Newtonsoft`**: os 2 pacotes do passo 2 não foram instalados.
- **Não conecta**: servidor rodando? URL certa? No celular use o IP da rede, não `localhost`. Firewall do PC pode bloquear a porta 3000.
- **Cápsulas cor-de-rosa (magenta)**: material sem shader compatível — use o template **3D Core (Built-In)**; se usar URP, crie o projeto pelo template URP de fato.
- **WASD não move**: confira o passo 4 (Active Input Handling = Both).
