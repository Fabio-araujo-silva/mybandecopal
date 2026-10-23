# mybandecopal

**O cardápio do bandejão da USP com calorias e macros — tipo MyFitnessPal, mas já sabendo o que tem no prato.**

🌐 **https://mybandecopal.vercel.app**

Abre direto na refeição do momento (almoço até as 13h30, jantar depois) e já mostra as calorias, a
proteína, o carboidrato e a gordura de uma bandeja média. Se você pegou mais arroz ou dispensou a
sobremesa, é só ajustar cada item — em conchas, colheres, fatias, hambúrgueres… as medidas que a
tia usa.

> Projeto independente, **não é um app oficial da USP**. Os números são estimativas e não substituem
> orientação de nutricionista.

---

## O que ele faz

- **Cardápio de todos os restaurantes da USP**, com o da Área 1 de São Carlos como padrão. Troca de
  restaurante, dia da semana e almoço/jantar.
- **Calorias e macros por item e da refeição inteira.** Cada prato vira uma receita aproximada feita
  com alimentos da tabela [TACO](https://nepa.unicamp.br/) (NEPA/UNICAMP).
- **Porções do jeito do bandejão:** 1 concha de arroz, 1 de feijão, 3 hambúrgueres, 2½ gomos de
  linguiça, 1 fatia de quibe… Os botões − / + andam de 1 em 1, e frações (1,5) se digitam.
- **Escolhas de verdade:** arroz branco ou integral, carne ou opção vegetariana, doce ou fruta
  (sobremesa é uma só, sempre).
- **Concha extra de molho:** quando o prato tem molho, dá para "pedir pra tia" mais uma concha.
- **Ajuste do bandejão:** +10% de calorias em forma de gordura nas preparações (a cozinha industrial
  usa mais óleo). Dá para desligar.
- **Trocar alimento:** qualquer item pode ser substituído por um dos 591 alimentos da TACO.
- **Avaliação em estrelas** da proteína, da guarnição e da sobremesa, sem login. A nota segue o
  prato: quando ele volta no cardápio, sua nota já está lá (e dá para mudar).
- **Painel /admin** com login: pessoas online, visitantes por dia, avaliações, porções que o
  pessoal escolhe de verdade (para calibrar os padrões), pratos que o parser não reconheceu e a
  saúde da API da USP.

Tudo que é preferência pessoal (porções, restaurante, notas) fica no `localStorage` do navegador.

## Como funciona

```
navegador ──► mybandecopal.vercel.app/api/menu ──► uspdigital.usp.br (API do app oficial)
              (função serverless: adiciona as        devolve o cardápio da semana
               credenciais do app e faz cache)
```

O cardápio vem da **mesma API que o app oficial Cardápio+ USP usa**.

Para poupar a API da USP, `lib/uspcache.js` guarda o cardápio de cada restaurante no Redis e só
consulta a USP de novo quando o guardado tem mais de 1 hora (a lista de restaurantes, 1 dia). A
cada consulta compara com o que já estava guardado e só regrava (e arquiva) se mudou; só uma
requisição por vez vai à USP, e se ela falhar o site segue com a última versão (nova tentativa
em 5 min). Na frente disso, a Vercel ainda guarda a resposta por 15 min.

### Estimativa nutricional

- `public/nutrition.js` quebra o texto do cardápio (que vem em formatos diferentes por campus) em
  itens, reconhece cada prato por regras (`RULES`) e o associa a uma receita (`DISHES`) feita de
  alimentos da TACO, por 100 g.
- O que a TACO não tem (proteína de soja, macarrão cozido, leite líquido, catchup…) está em
  `EXTRAS`, com valores da [TBCA 7.3](https://www.tbca.net.br/) (FCF-USP/FoRC) e o código de cada
  item. Exceções medidas no bandejão: picolé (58 kcal/unidade) e suco (53 kcal/200 ml com açúcar,
  39 sem).
- `public/receitas.json` guarda as receitas lidas no cartaz do bandejão: refinam pratos de
  `DISHES` ou criam novos (com regra de texto própria). Em proteína, opção vegetariana,
  guarnição, salada e sobremesa doce, as kcal do cartaz viram as kcal por grama do prato (a porção
  continua a do app) e os macros saem da composição pela TACO, na mesma proporção; o +10% de
  gordura do preparo continua valendo. Pão, arroz, feijão e fruta ficam sempre pela TACO.
  Prato sem cartaz segue só pela composição. `scripts/taco-busca.mjs "termo"` acha os ids e
  `scripts/check-receitas.mjs` valida e mostra a triangulação.
- Cada prato tem medidas caseiras e uma quantidade padrão. Pão e suco não entram por padrão (o
  minipão só entra sozinho nas refeições com hambúrguer).
- `node --env-file=.env scripts/check-menus.mjs` baixa os cardápios de todos os restaurantes e lista
  os itens que nenhuma regra reconheceu.

### Regras de escolha dos valores

De onde vêm as kcal de cada item, em ordem:

1. **Valores fixos medidos no bandejão:** picolé = 58 kcal/unidade; suco = 53 kcal/200 ml com
   açúcar e 39 kcal/200 ml sem. Nenhuma tabela ou cartaz muda isso.
2. **Pão, arroz, feijão e fruta:** sempre pela TACO, mesmo que o cartaz traga outro número
   (o número fica só anotado no histórico de `receitas.json`).
3. **Proteína, opção vegetariana, guarnição, salada e sobremesa doce com cartaz registrado:** valem
   as kcal do cartaz, convertidas em kcal por grama. Os macros saem da composição do prato pela
   TACO (TBCA só para ingrediente que a TACO não tem), escalados para bater com essas kcal.
4. **Sem cartaz registrado:** a estimativa pela composição TACO/TBCA, como sempre.

Quando o cartaz fica muito longe da composição (fator kcal do cartaz ÷ kcal da composição fora de
~0,7–1,5), primeiro se revisam as proporções da receita com os ingredientes listados. Se continuar
longe, a escolha é feita **caso a caso com o usuário** (a skill pergunta antes de gravar), com este
padrão:

- **cartaz alto demais** → vale o cartaz (ex.: macarrão à primavera a 230 kcal/100 g);
- **cartaz baixo demais** → vale a TACO (o cartaz não é gravado como valor).

A decisão fica registrada em `triangulacao` na receita. Valem para todos os itens:

- **porção:** sempre a do app (3 hambúrgueres de 45 g, conchas, colheres…); o peso do cartaz só
  serve para converter as kcal;
- **+10% de gordura do preparo:** o botão do app soma nas preparações, inclusive nas que têm
  cartaz (que ainda deixa gordura de fora).

### Registro da refeição (/admin)

A API da USP só diz "Suco" e "Saladas: Diversas". Quem está no bandejão registra no /admin o sabor
do suco ("uva/melancia") e marca as saladas do dia (a lista vem das saladas de `receitas.json`).
No app, o sabor aparece ao lado do suco ("uva – registrado 17h45") e as saladas marcadas entram no
lugar de "Saladas diversas"; sem registro, tudo continua como antes. Fica no Redis em
`mbp:registro:<restaurante>` e sai em `/api/registro?id=`.

### Pratos que mudaram

Três caminhos levam a um **"!" ao lado do prato** no app (tocar mostra o aviso):

- **A USP mudou o cardápio.** Quando o cache (`lib/uspcache.js`) vê que o cardápio de um
  restaurante mudou, `lib/registro.js` compara refeição por refeição (prato, guarnição, salada,
  sobremesa; diferença só de maiúscula/acento/pontuação não conta) e grava o que saiu, o que entrou
  e a hora em que descobrimos. O prato que entrou ganha o "!" ("antes era X"); no /admin aparece
  em "Pratos que mudaram" e no histórico "Mudanças detectadas no cardápio da USP".
- **Reports dos usuários.** No fim do app, "Mudou alguma coisa?" lista prato, opção, guarnição e
  sobremesa da refeição de hoje, com um botão "Mudou" e um campo opcional "o que tem no lugar?".
  Cada navegador conta uma vez por prato (`/api/report`, `lib/reports.js`). No /admin, a seção
  "Reports de mudança" (no fim da página) mostra quantas pessoas avisaram e as sugestões; a partir
  de **10** o report fica destacado. Aprovar pede o motivo (aparece no app, ex.: "Acabou essa
  opção") e, se quiser, o prato que entrou no lugar; descartar apaga. Reports com mais de 2 dias
  somem sozinhos.
- **O admin marca direto.** Em "Registro da refeição → Pratos que mudaram", qualquer prato da
  refeição escolhida pode ser marcado (motivo e/ou prato novo) ou desmarcado, sem esperar reports.

Com prato novo informado, o app passa a mostrar e calcular o novo prato no lugar do antigo.

## Rodar localmente

Requer **Node 20+**. Não há dependências para instalar.

```bash
cp .env.example .env      # e preencha os valores
node dev-server.mjs       # http://localhost:3000   (admin em /admin)
```

O servidor local imita a Vercel (arquivos de `public/` + funções de `api/`) e lê o `.env`. Sem Redis
configurado, as estatísticas e avaliações ficam em `.data/store.json`.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `USP_MENU_HASH`, `USP_DEV_KEY` | Credenciais do app oficial para buscar o cardápio. **Obrigatórias.** |
| `USP_OAUTH_CONSUMER_KEY`, `USP_OAUTH_CONSUMER_SECRET` | OAuth 1.0a do app oficial. Reservadas; o site atual não usa. |
| `ADMIN_PASSWORD` | Senha do painel `/admin` (mín. 8 caracteres). |
| `ADMIN_SESSION_SECRET` | Segredo aleatório que assina a sessão do admin. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis do Upstash. Sem ele, estatísticas e avaliações não persistem na Vercel. |

## Deploy na Vercel

1. Importe o repositório (preset **Other**, sem build command — o `vercel.json` já aponta para `public/`).
2. Em **Storage**, crie um banco **Upstash for Redis** (plano grátis) e conecte ao projeto. Isso cria
   `KV_REST_API_URL` e `KV_REST_API_TOKEN` sozinho.
3. Em **Settings → Environment Variables**, cadastre as outras variáveis da tabela.
4. Publique: `npx vercel --prod`.

## Privacidade

As estatísticas do painel são anônimas: cada navegador gera um identificador aleatório, sem nenhum
dado pessoal. Nenhum IP é guardado — ele só entra, como hash e por 15 minutos, no limite de
tentativas de login do admin. As avaliações também não pedem login.

## Estrutura

```
api/            funções serverless: menu, restaurants, track, rate, admin
lib/            cliente da API da USP, armazenamento (Redis/local), estatísticas, login do admin
public/         a página (index.html, app.js, nutrition.js, styles.css), admin.html e taco.json
scripts/        build-taco.mjs (gera taco.json) e check-menus.mjs (confere o parser)
data/taco/      CSVs da TACO 4ª ed.
dev-server.mjs  servidor local
```

## Créditos

- Tabela TACO 4ª edição revisada (2011) — NEPA/UNICAMP. CSVs normalizados por
  [raulfdm/taco-api](https://github.com/raulfdm/taco-api).
- Cardápio: SAS/PRIP – Universidade de São Paulo.

## Licença

[MIT](LICENSE). Os dados da TACO pertencem ao NEPA/UNICAMP; o cardápio, à USP.
