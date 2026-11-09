# YouTube Feed Cleaner

Userscript para cadastrar palavras e frases, destacar vídeos correspondentes no feed de inscrições e acionar a opção nativa “Ocultar” no menu do vídeo.

## Instalação para desenvolvimento

1. Instale Tampermonkey ou Violentmonkey.
2. Atualize no cabeçalho do userscript `rodrigomescua` (ou atualize as URLs caso o repositório fique em outra conta/organização).
3. Publique o arquivo `youtube-feed-cleaner.user.js` no branch `main`.
4. Instale pelo endereço `https://raw.githubusercontent.com/rodrigomescua/TubeFeedCleaner/main/youtube-feed-cleaner.user.js`.

Quando publicar uma nova versão, incremente `@version` no cabeçalho e envie o commit para GitHub. O gerenciador consulta `@updateURL` e baixa a atualização de `@downloadURL`.

## Greasy Fork e sincronização

O Greasy Fork pode importar um userscript completo a partir de uma URL externa e sincronizar as mudanças dessa origem. Para este repositório:

1. Importe `https://raw.githubusercontent.com/rodrigomescua/TubeFeedCleaner/main/youtube-feed-cleaner.user.js` pela opção **Importar scripts** do Greasy Fork.
2. Configure a sincronização automática ou acione a sincronização manual na página de edição do script.
3. Incremente `@version` a cada release e envie as alterações para o GitHub. Confirme no Greasy Fork que a sincronização criou a versão esperada.

O Greasy Fork fornece o endereço de instalação e as atualizações aos usuários. A importação sincroniza o código do script completo; não é necessário publicar uma biblioteca separada.

## Notas

- A interface do painel usa APIs seguras do DOM e funciona com Trusted Types estrito.
- O modo de ocultação automática é experimental e vem desligado. A ação manual aparece nos vídeos correspondentes.
- O painel mantém um histórico local dos últimos 100 vídeos ocultados automaticamente; ações manuais não entram nesse histórico.
- É possível ocultar visualmente as seções Shorts e Mais relevantes no feed de inscrições; essa opção não aciona a opção nativa “Ocultar”.
- O painel mostra avisos para alterações nos termos, opções, histórico e resultado das ações de ocultação.
- O script depende dos seletores da interface web do YouTube e pode precisar de ajustes quando a página mudar.

## Serviço Docker automatizado

O projeto também pode rodar como um serviço contínuo com interface web, worker Playwright e estado persistente em JSON.

```bash
docker compose build
docker compose up -d
```

As imagens publicadas ficam em `ghcr.io/rodrigomescua/tubefeedcleaner`. Para usar a última release sem compilar localmente, execute `docker compose pull` e `docker compose up -d --no-build`. Cada release publica as tags `latest`, `major`, `major.minor`, `version` e `sha`; as imagens são `linux/amd64`.

Commits seguindo [Conventional Commits](https://www.conventionalcommits.org/) geram um pull request de release automaticamente. Ao mesclar esse PR, o fluxo cria a GitHub Release, anexa o userscript e publica a imagem no GHCR. O CI executa `npm test` nos pull requests.

Abra `http://localhost:8080` para configurar os termos e consultar o histórico. O container permanece ativo com `restart: unless-stopped` e processa o feed no intervalo configurado em **Visão geral**. O padrão é 30 minutos; `INTERVAL_MINUTES` define o padrão inicial para novas instalações. Alterações feitas no painel ficam salvas e prevalecem sobre essa variável.

O serviço escuta apenas em `127.0.0.1:8080` por padrão. Para acessá-lo de outro computador, use um túnel SSH ou um proxy reverso com HTTPS e autenticação. O painel e o navegador de login dão acesso à conta; não exponha a porta diretamente na rede ou na internet. Para publicar atrás de um proxy em outro computador, ajuste o mapeamento de porta no Compose e proteja o acesso ao painel inteiro.

### Conectar ao YouTube

1. Abra `http://localhost:8080` e clique em **Conectar ao YouTube**.
2. Faça login na conta Google na janela exibida no painel, incluindo a verificação em duas etapas se solicitada.
3. Clique em **Concluí o login**. O aplicativo verifica a sessão e retoma a automação. Se a sessão expirar, repita o procedimento.

O navegador de login e o worker rodam no mesmo container e usam o perfil persistido em `./browser-profile/cleaner-profile`. Durante o login, a automação fica pausada. Não exclua esse diretório se quiser preservar a sessão. Instalações anteriores mantêm o perfil antigo, mas precisam conectar a conta novamente. O Google pode solicitar uma verificação adicional ou bloquear o acesso ao navegador automatizado; nesse caso, siga as instruções exibidas pelo Google.

Se o Google recusar o navegador do container, use **Importar cookies** no painel. Exporte apenas os cookies de `youtube.com` no formato Netscape `cookies.txt` usando uma extensão de sua confiança; a [documentação do yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies) descreve uma forma de exportação com janela anônima. O aplicativo valida a sessão antes de importá-la e pode ser necessário repetir o processo quando ela expirar. O arquivo permite acesso à conta: não o compartilhe e apague-o depois da importação.
