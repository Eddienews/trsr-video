# TRSR Video

[English](README.md) | **Português**

Estúdio de vídeo com IA da NorthWindLab Studio. Você monta o filme (história, personagens, cenário, tomadas, visual), escolhe a plataforma e o modelo, vê o custo, confirma e recebe o vídeo. Também dá para só copiar o prompt e gerar em outro lugar. Licença MIT.

## Telas

![O estúdio: projeto à esquerda, monitor e escolha do modelo no meio, gerações à direita, linha do tempo embaixo](docs/screenshots/studio.png)

O estúdio. Projeto à esquerda, monitor com a escolha de plataforma, modelo e resolução no meio, gerações à direita, linha do tempo das tomadas embaixo. As imagens mostram a interface em inglês; o português fica em Configurações.

![A janela de confirmação com o custo estimado](docs/screenshots/generate.png)

A janela de confirmação. Nada é enviado nem cobrado antes do "OK, gerar".

![Tomadas à esquerda e o prompt que será enviado à direita](docs/screenshots/shots-and-prompt.png)

As tomadas e o prompt que vai para o modelo.

![Configurações: idioma e um campo de chave por plataforma](docs/screenshots/settings.png)

Configurações: idioma e uma chave por plataforma. As chaves ficam no `.env` local.

## Estado atual

Funciona: o montador de prompt (completo, compacto e por tomada), o servidor local com as chaves no `.env`, o registro de modelos, nove plataformas, estimativa de custo, janela de confirmação, fila de um pedido por vez, download do MP4, lista de gerações com monitor e teste de chave.

Ainda não foi feito: biblioteca com filtros e comparação lado a lado, agente que preenche o formulário a partir de um pedido livre, imagens de referência, Leonardo.

Os adaptadores foram escritos a partir da documentação de cada plataforma e são cobertos por testes com respostas simuladas. Contra as APIs reais até agora: o teste de chave (Runware, Higgsfield e Krea) e uma geração na Runware (Seedance 2.0 Mini). Nas outras plataformas, a primeira geração é o teste de verdade.

## Usar

Requer Node 20 ou mais novo.

```
npm install
npm start            # monta a interface e abre o servidor em http://127.0.0.1:4477
```

No Windows, `start.bat` faz as duas coisas.

As chaves são salvas na tela **Configurações**, que grava o arquivo `.env`, ou direto no `.env` a partir do `.env.example`. A chave fica só no servidor: o navegador recebe apenas os 4 últimos caracteres, e ela não entra em logs nem no histórico. **Testar chave** faz uma consulta de leitura ao provedor, sem gerar nada.

O servidor escuta só em `127.0.0.1`. Publicar num servidor exige um login na frente: quem alcança a porta gasta o crédito.

Para desenvolver a interface: `npm run server` num terminal e `npm run dev` em outro (http://localhost:5173).

## O que acontece ao gerar

1. Abaixo do monitor você escolhe **Plataforma**, **Modelo** e **Resolução**; o custo estimado aparece ao lado.
2. Se a soma das tomadas não bate com a duração, ou a duração não cabe no modelo, um botão ajusta as tomadas mantendo a quantidade e as proporções.
3. **Gerar vídeo** abre a janela com modelo, tamanho, duração, áudio, custo estimado (com a data do preço) e o texto exato do prompt.
4. Só o **OK, gerar** envia. O servidor recusa pedidos sem a confirmação ou com um valor diferente do que foi mostrado.
5. Os pedidos rodam um de cada vez. Chave recusada ou falta de saldo param a fila, sem tentar de novo.
6. O MP4 é baixado para `data/videos` e aparece no monitor. Quando o provedor informa o custo real, ele fica ao lado do estimado.

## Plataformas

| Plataforma | Modelos no registro | Cancela | Informa custo real |
|---|---|---|---|
| Runware | Seedance 2.0 Mini, Seedance 2.5, Kling 4.0 Flash | não | sim |
| Higgsfield | Seedance 2.5, Kling 4.0 Flash | só na fila | não |
| Runway | Gen-4.5, Seedance 2.5 | sim | não |
| Pika | Pika 2.5 | não | sim |
| xAI | Grok Imagine Video 1.5, 1.5 Lite e clássico | não | não |
| LTX | LTX-2.3 e LTX-2.5, Fast e Pro | não | não |
| Kling | Kling 4.0 Flash, Kling 4.0 | não | não |
| Google | Gemini Omni 1.1 Flash (o modelo decide a duração) | não | não |
| Krea | Veo 3.1; Seedance listado, sem preço conferido | sim | não |

## Modelos e preços

`registry/models/*.json` tem uma entrada por modelo: duração, tamanhos por resolução e formato, preço por segundo, limite do prompt, se faz várias tomadas numa geração. `null` significa "não conferido na documentação": o app não oferece essa opção. `pricing.source` diz se o preço vem da tabela do provedor (`official`) ou de uma geração real (`measured`), e `asOf` é a data. Preços mudam: confira antes de confiar.

Para adicionar um modelo de uma plataforma que já existe, basta uma entrada nova. Para uma plataforma nova: uma entrada em `registry/providers.json`, um arquivo em `packages/server/src/providers/` com `submit`, `poll` e, se o provedor permitir, `cancel`, uma linha em `providers/check.ts` para o teste de chave e o registro do adaptador em `main.ts`.

## Os três prompts

- **Completo:** 19 seções, de SCENE CONTEXT a FINAL POSITIVE LOCKS. Vai para modelos que fazem cortes numa geração e têm espaço para ele.
- **Compacto:** o mesmo filme em cerca de metade do texto. Vai sozinho para modelos com limite curto de prompt ou de clipe único; neles as tomadas viram uma ação contínua.
- **Por tomada + keyframes:** referências de personagem, cenários vazios, quadro inicial e final e um prompt curto por tomada, para fluxos locais de primeiro e último quadro. É só para copiar.

## Testar

```
npm test             # testes de unidade; os de provedor usam respostas simuladas e não gastam crédito
npm run typecheck
```

`packages/core/test/golden` guarda o que a página original v2.2 produzia para cada estado de exemplo. O prompt completo e o por tomada precisam continuar idênticos a esses arquivos; uma mudança no texto tem de ser intencional.

## Pastas

```
packages/core/src/
  presets.ts            tons, som e fala, estilos, luzes
  state.ts              formato do estado, blank(), example()
  prompt/single.ts      prompt completo
  prompt/compact.ts     prompt compacto e a escolha automática
  prompt/perShot.ts     por tomada + keyframes
  checks.ts             as 12 travas
  models.ts             tamanho, validação por modelo, reescala das tomadas, custo
packages/server/src/
  env.ts                leitura e gravação do .env
  registry.ts           carrega registry/
  providers/            um arquivo por plataforma, check.ts (teste de chave), http.ts
  jobs.ts               fila, acompanhamento, download, histórico em data/jobs.json
  app.ts                rotas /api
packages/web/
  index.html            a tela do estúdio
  src/main.js           formulário, linha do tempo, prompt
  src/generate.js       plataforma e modelo, gerar, configurações, gerações, monitor
  src/ui.js             abas, tema, versão
registry/               providers.json e models/*.json
legacy/                 a página v2.2 original, referência dos goldens
data/                   fora do git: jobs.json e videos/
```
