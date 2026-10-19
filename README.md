# VANTA CS2 — Versão 3.0, login Steam

## Rodar localmente

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env` e preencha. **O Node não lê `.env` automaticamente nesta implementação**; use Node 20.6+ com `node --env-file=.env server.js` ou exporte as variáveis no seu host.
3. Rode `node --env-file=.env server.js` e abra `http://localhost:3000`.
4. Para produção, configure BASE_URL com a URL pública em HTTPS, SESSION_SECRET com 32+ caracteres aleatórios, e STEAM_API_KEY no ambiente da hospedagem. Configure a origem/host da API Key na Steam quando solicitado.

A autenticação usa OpenID 2.0 da Steam e valida a resposta no servidor (`check_authentication`). A sessão é um cookie HttpOnly assinado por HMAC, expira em 7 dias. Nenhuma senha Steam é solicitada.

O perfil usa ISteamUser/GetPlayerSummaries se STEAM_API_KEY estiver preenchida. Sem chave, ainda é possível autenticar e identificar o SteamID, mas o nome/avatar não serão recuperados. O inventário consulta apenas itens públicos de CS2 (app 730/context 2); a Steam pode bloquear/limitar o endpoint ou impedir contas privadas. Sem autorização, não se acessa inventário privado.

## Verificação

```sh
node --check server.js
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\\s\\S]*?)<\\/script>/);new Function(s[1]);console.log('JS valid')"
```

Não suporta operações reais de compra, venda, saque, trocas, guarda de skins ou abertura de caixas pagas. Os preços e as propostas ainda são demonstrações locais. Este projeto não é afiliado à Valve.

## Publicação

Em um serviço de hospedagem Node que disponibilize HTTPS, configure Start Command `npm start` e as quatro variáveis PORT (normalmente fornecida pela plataforma), BASE_URL, SESSION_SECRET e STEAM_API_KEY. A URL em BASE_URL precisa ser o endereço exato utilizado no navegador (incluindo https). **Não publique** o conteúdo de `.env`.
