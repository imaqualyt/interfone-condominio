# Interfone Condomínio — protótipo local (PWA)

Protótipo testável de um interfone de condomínio: o morador fala com a **portaria** e com **outros apartamentos** por **voz pela internet (WebRTC)**, sem depender do WhatsApp.
Tudo roda em uma máquina só (`http://localhost`), com várias abas do navegador fazendo o papel de porteiro, morador e proprietário.

## O que tem

| Parte | Onde |
|---|---|
| App do morador (cadastro, contatos por apartamento, tela de chamada, avisos por bloco, histórico do apto) | `/morador/` |
| Painel da portaria (busca por apto, chamar, receber chamadas, histórico, avisos) | `/portaria/` |
| Servidor (Node + Express + `ws`): cadastros, roteamento de chamadas, regra dos dois números, sinalização WebRTC, histórico | `server.js` |
| PWA: `manifest.json`, `sw.js` (cache da interface), ícones, meta tags do iOS, faixa "sem conexão" | `public/` |

### Regra dos dois números (fallback)
Cada apartamento tem até **2 cadastros**: **morador** (1º a tocar) e **proprietário** (2º).

1. A chamada toca no morador por ~30 s (padrão).
2. Se ele **não atender**, **recusar** ou estiver **offline/ocupado** → toca no proprietário por ~30 s.
3. Se ninguém atender → quem ligou vê **"Apto indisponível"** e a chamada vai para o **histórico** (com o resultado de cada tentativa).

O tempo por número pode ser encurtado para a demonstração com `?timeout=10` na URL **da aba de quem liga** (vale de 3 a 120 s).

## Como rodar

Requisitos: Node.js 18+ e um navegador moderno (Chrome, Edge, Firefox, Safari).

```bash
cd interfone-condominio
npm install
npm start          # sobe em http://localhost:5180
```

- Morador: http://localhost:5180/morador/
- Portaria: http://localhost:5180/portaria/
- Para voltar ao estado inicial (apaga os cadastros e o histórico): `npm run reset` (com o servidor parado ou reinicie-o depois).
- Outra porta: `PORT=3000 npm start`. Outro tempo padrão: `TIMEOUT=15 npm start`.

### Dados de demonstração (seed)
Apartamentos: **101, 102, 201, 202** (Bloco A) e **301, 302** (Bloco B).
Já vêm cadastrados, mas **sempre offline** (ninguém logado): **201** (Carla — morador; Roberto — proprietário) e **202** (Marcos — morador). Servem para ver o "Apto indisponível" na hora.
Os aptos **101, 102, 301 e 302** começam vazios: cadastre você mesmo no teste abaixo.

## Roteiro de teste (passo a passo, ~5 minutos)

> Use **abas diferentes da mesma janela** (ou janelas). Cada aba mantém o seu próprio login. Quando o navegador pedir permissão do **microfone**, clique em **Permitir**. Use headset ou fones para não dar eco entre abas.

**Preparação — 4 abas**

1. **Aba 1 – Portaria:** abra `http://localhost:5180/portaria/?timeout=10`, digite um nome (ex.: "Seu José") e clique em **Abrir painel e receber chamadas**. Na aba **Chamar apto**, clique em **🔔 Ativar notificações e som de chamada** e permita.
2. **Aba 2 – Morador 101:** abra `http://localhost:5180/morador/?timeout=10`. Em **Cadastrar**, preencha: nome *Ana Paula*, apartamento *101*, telefone *21 98888-0101*, você é *Morador*. Toque em **Cadastrar e entrar**. Clique em **🔔 Ativar notificações…** e permita.
3. **Aba 3 – Proprietário 101:** abra outra aba em `http://localhost:5180/morador/?timeout=10`, cadastre *Paulo Dono*, apto *101*, telefone *21 97777-0101*, você é *Proprietário*. Ative as notificações.
4. **Aba 4 – Morador 102:** outra aba em `http://localhost:5180/morador/?timeout=10`, cadastre *Bruno Lima*, apto *102*, telefone *21 98888-0102*, *Morador*.

**Teste 1 — Porteiro chama o apto 101 e o morador atende (voz)**

1. Na **Portaria**, ache o **101** (pode digitar "101" na busca) e clique em **📞 Chamar**.
2. Na **aba 2 (Ana)** aparece a tela de chamada com toque e notificação. Clique em **Atender**.
3. Os dois lados mostram **"Em chamada"** com o cronômetro; fale e ouça o áudio (com fones). Teste **Mudo** e depois **Desligar**.
4. Em **Histórico** (Portaria) a chamada aparece como **Atendida**, sem 2º número.

**Teste 2 — Ver o fallback (o ponto principal)**

1. Na **Portaria**, clique em **📞 Chamar** no **101** e **NÃO atenda na aba 2 (Ana)**.
2. A portaria mostra "Chamando Morador…". Depois de **10 s** (30 s sem o `?timeout`) a chamada **some da aba da Ana** ("Chamada perdida") e **começa a tocar na aba 3 (Paulo, proprietário)**; a portaria passa a mostrar "Chamando Proprietário…".
3. Atenda na **aba 3**: a voz conecta com o proprietário. Desligue.
4. No **Histórico**: **Atendida** + etiqueta **usou 2º número**, com "1º Ana: não atendeu → 2º Paulo: atendeu".
5. Variação: repita e, na aba 2, clique em **Recusar** — o proprietário toca **na hora**.

**Teste 3 — Ninguém atende → "Apto indisponível"**

1. Chame o **101** de novo e não atenda em nenhuma das duas abas.
2. Depois dos dois tempos (20 s com `?timeout=10`), a portaria vê **"Apto indisponível"** e o histórico registra a chamada como indisponível, com as duas tentativas "não atendeu".
3. Chame o **201** (seed, sempre offline): "Apto indisponível" aparece **imediatamente**, com "fora do ar" nas duas tentativas.

**Teste 4 — Morador ↔ morador e morador → portaria**

1. Na **aba 4 (Bruno, apto 102)**, em **Contatos**, clique em **📞 Ligar** no **Apto 101**. Toca no morador (Ana) e, se não atender, no proprietário (Paulo), como na portaria.
2. Na aba 4, clique em **Ligar** no cartão **🛎️ Portaria**: a chamada toca no painel da portaria (em todas as abas de portaria abertas — quem atender primeiro fica com ela).
3. Chamada de um morador para o **próprio apartamento** toca no *outro* número do apto (o próprio aparelho é pulado).

**Teste 5 — Aviso por bloco (grupo simples)**

Na aba 4, aba **Avisos**, escreva um texto e envie: aparece na hora para todos os moradores online do **Bloco A** (e para a portaria). A portaria também pode enviar para um bloco específico ou para todos.

**Teste 6 — Notificação e toque**

Com a aba do morador **em segundo plano** (outra aba à frente), receba uma chamada: aparece uma **notificação do navegador** ("Chamada do interfone") e o toque toca enquanto a aba/app estiver aberto. Clicar na notificação volta para o app.

## Instalar como app (PWA)

O protótipo é um PWA: tem `manifest.json` (nome "Interfone Condomínio", ícones 192/512 e *maskable*, `display: standalone`), service worker com cache da interface e meta tags para iOS.

- **Android (Chrome):** abra `/morador/` → menu **⋮** → **Instalar app** (ou **Adicionar à tela inicial**). Também aparece o botão **Instalar app** no topo da tela.
- **iPhone (Safari):** abra `/morador/` → botão **Compartilhar** → **Adicionar à Tela de Início**.
- **Computador (Chrome/Edge):** ícone de instalar na barra de endereço.
- O painel da portaria (`/portaria/`) também é instalável (ícone próprio no manifest `manifest-portaria.json`).

**Importante — HTTPS:** instalar o app, usar o **microfone** e registrar o **service worker** em um **celular** exigem **HTTPS**. Somente `http://localhost` é exceção (por isso funciona no computador onde o servidor roda). Para testar em um celular é preciso expor o servidor com HTTPS (um túnel HTTPS ou uma hospedagem com certificado) — **este projeto não configura nenhum túnel, conta ou publicação**. Em `http://192.168.x.x` (rede local) o celular **não** libera o microfone nem instala o app.

**Offline:** sem rede, a interface (telas de cadastro/contatos/painel) abre pelo cache do service worker e aparece uma **faixa amarela de "sem conexão"**; as ligações, contatos e histórico, claro, precisam do servidor.

## Notificações — o que este protótipo faz e o que vem na versão nativa

Aqui a notificação usa a **Notification API do navegador** + toque (Web Audio) + vibração, e **só funcionam com a aba ou o app aberto** (o navegador pode suspender abas muito antigas em segundo plano). Chamada com o **app fechado** (push real) exige a versão nativa: **FCM** (Android) e **APNs/PushKit + CallKit** (iPhone), além de tela cheia de chamada recebida.

## Como funciona (resumo técnico)

- **Sinalização:** WebSocket em `/ws`. Mensagens: `hello`, `call:start`, `call:incoming`, `call:answer`, `call:decline`, `call:hangup`, `rtc` (SDP/ICE), `aviso`.
- **Roteador de chamadas** (`server.js`): monta a lista de números do apto (morador → proprietário), toca em cada um com temporizador, trata recusa/offline/ocupado, registra o histórico em `data/data.json` e avisa o painel da portaria.
- **Áudio:** WebRTC ponto a ponto entre as duas pontas, usando **STUN público** `stun:stun.l.google.com:19302`. O servidor só repassa a sinalização.
- **Dados:** em memória, gravados em `data/data.json` (apague com `npm run reset`).
- **Sem login de verdade:** a "conta" é apto + telefone, sem SMS. É um protótipo.

## Testes automáticos

```bash
npm run test:e2e    # Chrome headless (puppeteer-core): PWA, cadastro, chamadas, fallback, "Apto indisponível", offline
npm run test:node   # pares WebRTC em Node (werift): prova ICE/DTLS "connected" pela sinalização real do servidor
```
- `test:e2e` usa o Chrome instalado (`CHROME=/caminho/do/chrome` se for outro) e sobe um servidor próprio na porta 5181 com dados temporários.
- **Em máquinas em que o Chrome tem a política `WebRtcIPHandling` restrita** (ex.: ambientes gerenciados), o Chrome não gera candidatos ICE; o `test:e2e` detecta isso e verifica a negociação SDP, e o `test:node` cobre o "connected". Em um Chrome normal, o `test:e2e` verifica `iceConnectionState = connected` e bytes de áudio recebidos.

## Limitações

- **Sem TURN:** só há STUN. Em redes com NAT simétrico/firewall rígido (muito comum em 4G e redes corporativas) o áudio pode **não conectar**. Em produção é necessário um servidor **TURN** (ex.: coturn) com credenciais temporárias.
- **Sem push real:** toque e notificação só com o app/aba aberto. Produção: FCM/APNs, PushKit/CallKit (iOS) e ConnectionService (Android).
- **Sem autenticação forte:** sem confirmação do telefone por SMS e sem aprovação da portaria; qualquer pessoa com apto + telefone entra. O painel da portaria não tem senha.
- **Telefone não disca:** o "número" é só um cadastro; a chamada é pela internet, não pela rede telefônica.
- **Um servidor, memória/JSON:** não escala nem tem backup; reiniciar mantém `data/data.json`, mas não há banco de dados.
- **Chamadas 1:1 apenas;** o "grupo" é só aviso de texto por bloco (sem voz em grupo).
- **Eco:** duas abas no mesmo computador captam o áudio uma da outra — use fones.
- **HTTP em rede local não libera microfone** em celulares (precisa de HTTPS; veja acima).
- **iOS:** o PWA do Safari tem limitações (áudio/microfone em segundo plano, sem push com app fechado em todas as versões).
- Ícones desenhados por código (`npm run icones`) — provisórios.

## App Android nativo (Flutter) — `app-android/`

App nativo **"Interfone Condomínio"** (pacote `br.com.paulo.interfone`) que usa **o mesmo servidor Node** (`server.js`), com o **mesmo protocolo, regras e seed** da versão web. Web/PWA e app conversam entre si: um porteiro no navegador pode ligar para um morador no app e vice-versa.

- **APK:** `InterfoneCondominio.apk` (na raiz do projeto, ~15 MB, Android 7.0+, só celulares 64 bits/arm64, assinado com a chave de *debug*).
- **O que tem:** escolha de perfil no primeiro uso (**Morador/Proprietário** com cadastro ou **Portaria**), contatos por apartamento e bloco com status online, ligar para um apartamento ou para a portaria, tela de chamada (**Atender, Recusar, Mudo, Viva-voz, Desligar**), selo **"2º número"** quando o servidor passa para o proprietário, **"Apto indisponível"**, histórico, avisos por bloco, tema claro/escuro (Material 3) e **Ajustes** com o endereço do servidor.
- **Chamada recebida:** toque do celular em loop + **notificação de chamada em tela cheia** (com botões Atender/Recusar). Com **"Manter conectado em segundo plano"** ligado (padrão), o app roda um **serviço em primeiro plano** (notificação fixa "Interfone conectado") que mantém a conexão com o servidor com o app minimizado.
- **Permissões pedidas:** microfone, notificações (Android 13+) e, em Ajustes, "notificações em tela cheia" (Android 14+).

### Instalar o APK (Android)
1. Copie `InterfoneCondominio.apk` para o celular (WhatsApp, Drive, cabo USB…) e toque no arquivo.
2. Se o Android avisar, toque em **Configurações** e ative **"Permitir desta fonte"** (fontes desconhecidas) para o app que abriu o arquivo; volte.
3. Toque em **Instalar** e depois em **Abrir**.
4. Permita **microfone** e **notificações**. Em **Ajustes › Chamada em tela cheia › Abrir**, libere a permissão (Android 14+).

> Como o APK é assinado com a chave de debug desta máquina, as próximas versões precisam ser compiladas aqui mesmo para instalar por cima. Se o Play Protect avisar, toque em "Instalar mesmo assim".

### Apontar o app para o servidor
No app: **⚙️ Ajustes › Servidor**, digite o endereço e toque em **Testar e salvar**.

| Onde o app roda | Endereço |
|---|---|
| Emulador Android no mesmo computador do servidor | `http://10.0.2.2:5180` (padrão) |
| Celular de verdade na **mesma rede Wi-Fi** do computador (só teste) | `http://IP-DO-COMPUTADOR:5180` (ex.: `http://192.168.0.10:5180`; descubra com `ipconfig`/`ip addr`; libere a porta 5180 no firewall) |
| Uso real (fora de casa, 4G) | servidor **hospedado na internet**, de preferência com **HTTPS** (ex.: `https://interfone.seudominio.com.br`) — o app usa **WSS** automaticamente |

Este protótipo permite HTTP sem criptografia (`network_security_config.xml`) só para teste; em produção use HTTPS/WSS e um servidor **TURN**. **Nenhuma hospedagem, conta ou túnel foi configurada.**

### Testar com dois celulares + a portaria
Pré-requisito: o servidor rodando no computador (`npm start`) e os celulares no mesmo Wi-Fi apontando para `http://IP-DO-COMPUTADOR:5180`.
1. **Portaria:** no computador abra `http://localhost:5180/portaria/?timeout=10` (ou instale o APK num 3º aparelho e escolha **Portaria**).
2. **Celular 1:** abra o app › **Morador ou proprietário** › **Cadastrar**: *Ana Paula*, apto *101*, *21 98888-0101*, **Morador**.
3. **Celular 2:** **Cadastrar**: *Paulo Dono*, apto *101*, *21 97777-0101*, **Proprietário**.
4. **Atendida:** na portaria, chame o **101** › toca no celular 1 (tela de chamada / notificação em tela cheia) › **Atender** › fale (teste **Mudo** e **Viva-voz**) › **Desligar**.
5. **Fallback:** chame o **101** e **não atenda no celular 1**. Depois de 10 s ele mostra "Chamada perdida" e **o celular 2 toca** com o selo "Você é o 2º número deste apto". Atenda no celular 2. No histórico: "usou 2º número".
6. **Recusa:** chame de novo e toque **Recusar** no celular 1 → o celular 2 toca na hora.
7. **Indisponível:** não atenda em nenhum → a portaria vê **"Apto indisponível"**.
8. **Morador → portaria:** no celular 1, **Ligar** no cartão **Portaria**.
9. **Segundo plano:** minimize o app no celular 1 (botão início) e chame de novo: aparece a notificação de chamada com toque.
10. Para encurtar o toque quando o **celular** liga: **Ajustes › Tempo de toque por número › 10 s**.

### Compilar e testar o app
Toolchain: Flutter (com JDK 17 e Android SDK). Em `app-android/`:
```bash
flutter analyze
flutter test test/validacao_test.dart test/call_controller_test.dart test/widget_test.dart
INTERFONE_URL=http://localhost:5180 flutter test test/smoke_servidor_test.dart   # precisa do servidor no ar (cadastra usuários de teste no apto 302)
flutter build apk --release --target-platform android-arm64
```
O APK sai em `app-android/build/app/outputs/flutter-apk/app-release.apk` (copie para a raiz como `InterfoneCondominio.apk`). Ícone original gerado por `python3 tool_gerar_icone.py`.

### Limitações do app Android
- **App totalmente fechado não recebe chamada.** Se o app for removido da lista de recentes (ou o Android matar o processo), a conexão cai. Receber com o app fechado exige **push FCM**, que precisa de um **projeto Firebase** (conta Google) — **não configurado**. O ideal seria FCM de alta prioridade + `ConnectionService`/tela de chamada do sistema.
- Alguns fabricantes (Xiaomi, Samsung, Motorola…) economizam bateria e podem matar o serviço em segundo plano: desative a otimização de bateria para o app.
- **Sem TURN:** só STUN público; em 4G/NAT restrito o áudio pode não conectar.
- **Não testado em aparelho físico nem emulador** nesta máquina (não há emulador aqui): o que foi testado está listado abaixo; teste real de áudio, toque e tela cheia precisa ser feito no celular.
- Só **arm64** (celulares 64 bits, praticamente todos desde 2017); não roda em emulador x86_64 — para emulador, compile sem `--target-platform` e sem o filtro de ABI do `build.gradle.kts`.
- Cadastro sem SMS e portaria sem senha (como na versão web).
- Assinatura de debug: não é para publicar na Play Store.

### O que foi verificado (app)
- `flutter analyze`: sem problemas.
- 16 testes de unidade/widget (tela de 360 px): validação do cadastro, estados da chamada (chamando → 2º número → atendida → em chamada → desligada; recebida como 2º número; chamada perdida; recusa; "Apto indisponível") e tela de chamada mostrando o selo do 2º número e os botões Atender/Recusar/Mudo/Viva-voz/Desligar.
- Teste de fumaça **contra o servidor real** (porta 5180): cliente de sinalização + controlador de chamadas do app; porteiro → apto 302, morador não atende, proprietário toca após ~3 s e atende, oferta/resposta SDP e candidatos ICE passam pelo servidor, histórico registra "atendida, usou 2º número".
- APK release: pacote, nome, permissões, serviço `remoteMessaging`, `showWhenLocked`/`turnScreenOn`, `networkSecurityConfig`, só `arm64-v8a`, assinatura debug conferidos com `aapt2`/`apksigner`.

## Estrutura

```
interfone-condominio/
├─ server.js, store.js, seed.js      servidor, dados e seed
├─ public/
│  ├─ index.html                     escolha de perfil
│  ├─ morador/  portaria/            telas
│  ├─ js/ (interfone.js, morador.js, portaria.js, pwa.js)
│  ├─ css/app.css
│  ├─ manifest.json, manifest-portaria.json, sw.js
│  └─ icons/                         192, 512, maskable, apple-touch-icon
├─ scripts/ (gerar-icones.js, reset.js)
├─ tests/ (e2e.js, webrtc-node.js)
├─ screenshots-demo/                 capturas de tela do teste
├─ data/data.json                    gerado em execução
├─ app-android/                      app Android nativo (Flutter)
└─ InterfoneCondominio.apk           APK do app Android
```
