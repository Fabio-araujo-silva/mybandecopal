# mybandecopal

**O cardápio do bandejão da USP com calorias e macros — tipo MyFitnessPal, mas já sabendo o que tem no prato.**

🌐 **https://mybandecopal.vercel.app**

Abre direto na refeição do momento (almoço até as 15h, jantar depois) e já mostra as calorias, a
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
- **Enviar pro MyFitnessPal:** mostra (e copia) os números prontos para a *Adição rápida* do app.
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

O cardápio vem da **mesma API que o app oficial Cardápio+ USP usa**. Ela não é pública nem
documentada: cada pedido precisa de duas credenciais fixas do app, e a USP não libera CORS para o
navegador. Por isso existe o proxy em `api/`, que roda no servidor, guarda o cardápio em cache por
15 minutos e nunca expõe as credenciais para quem acessa o site.

**As credenciais não estão neste repositório.** Elas ficam em variáveis de ambiente (`.env` local e
painel da Vercel). Sem elas o site carrega, mas não consegue buscar o cardápio. Se a USP trocar
essas credenciais ou os endereços, o site para de funcionar até alguém atualizar os valores.

### Estimativa nutricional

- `public/nutrition.js` quebra o texto do cardápio (que vem em formatos diferentes por campus) em
  itens, reconhece cada prato por regras (`RULES`) e o associa a uma receita (`DISHES`) feita de
  alimentos da TACO, por 100 g.
- O que a TACO não tem (proteína de soja, macarrão cozido, refresco, picolé…) está em `EXTRAS`,
  derivado da própria TACO quando possível e marcado como "estimativa" na tela.
- Cada prato tem medidas caseiras e uma quantidade padrão. Pão e suco não entram por padrão (o
  minipão só entra sozinho nas refeições com hambúrguer).
- `node --env-file=.env scripts/check-menus.mjs` baixa os cardápios de todos os restaurantes e lista
  os itens que nenhuma regra reconheceu.

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
