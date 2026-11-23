# AutPlanner Microsoft

Extensão local para Google Chrome (Manifest V3) que automatiza **checklists de tarefas no Microsoft Planner**, aproveitando a sessão Microsoft 365 já autenticada no perfil atual do navegador.

> **Status:** versão 4.2.4 — experimental. A automação depende da interface web do Planner e deve ser testada primeiro em uma única Story. Não é produto oficial da Microsoft.

## Funcionalidades

- Seleção múltipla de Stories por código/prefixo.
- Abertura automática de cada tarefa pelo ID exportado do Planner.
- Inclusão exclusiva de itens ausentes, evitando duplicações.
- Validação da lista por até cinco leituras **sem recarregar a página** (observação do DOM atual).
- Relatório de cards validados, itens inseridos, existentes e erros.
- Interrupção segura diante de resultados inconclusivos.
- Utiliza **o perfil do Chrome já logado**, sem solicitar senha ou token.

## Estrutura

```text
AutPlanner-Microsoft/
├── manifest.json
├── background.js
├── painel.html
├── painel.js
├── config.example.json
├── cards.example.json
├── .gitignore
├── LICENSE
└── README.md
```

## Configuração inicial

1. Clone o repositório.
2. Copie `config.example.json` para `config.local.json` e informe o endereço de seu plano (URL-base da visualização de cards, finalizada em `/task/`) e o `tid` da URL do Planner.
3. Copie `cards.example.json` para `cards.json` e preencha apenas os IDs, títulos, códigos e itens de checklist das tarefas que você pode editar. Se você já possui o pacote v4.2 anterior, **copie o `cards.json` desse pacote** para a pasta clonada e confira os dados.
4. Abra `chrome://extensions` no **perfil Chrome autenticado**; ative **Modo do desenvolvedor** e clique **Carregar sem compactação**.
5. Selecione a **raiz do repositório clonado**, onde está o arquivo `manifest.json`.
6. Abra o Microsoft Planner em outra aba, feche o DevTools dessa aba e clique no ícone da extensão para abrir o painel.
7. **Alternativa à cópia:** no painel, importe os arquivos `cards.json` e `config.local.json` pelos campos de seleção. A extensão armazenará os dois no `chrome.storage.local`; não será necessário repetir a importação ao recarregar a extensão no mesmo perfil.

Os arquivos `config.local.json` e `cards.json` são **locais e ignorados pelo Git**: não publique IDs de tarefas, URLs de planos, dados de colaboradores ou informações internas da empresa em um repositório público.

## Utilização

1. Selecione apenas **uma Story** e execute para validar o fluxo.
2. Confira manualmente o resultado na interface do Planner.
3. Se a Story permanecer consistente após recarregar, marque as demais Stories e inicie o lote.
4. O script pula os itens existentes e pára ao encontrar uma gravação não confirmada.
5. Copie o relatório de execução do painel para auditoria.

## Instalação por Git

### Primeira vez — HTTPS

```powershell
cd "$env:USERPROFILE\Downloads"
git clone https://github.com/llongaray/AutPlanner-Microsoft.git
cd .\AutPlanner-Microsoft
```

### Primeira vez — SSH

```powershell
cd "$env:USERPROFILE\Downloads"
git clone git@github.com:llongaray/AutPlanner-Microsoft.git
cd .\AutPlanner-Microsoft
```

### Atualizações futuras

```powershell
cd "$env:USERPROFILE\Downloads\AutPlanner-Microsoft"
git pull --ff-only origin main
```

Depois do `git pull`, abra `chrome://extensions` e clique em **Recarregar** na extensão. Seus arquivos locais ignorados pelo Git serão preservados.

> Se a pasta estiver em outro local, copie o caminho exibido pelo Explorador, abra o PowerShell nessa pasta e execute `git pull --ff-only origin main`.

## Segurança e permissões

A permissão `debugger` permite à extensão enviar eventos de teclado pelo Chrome DevTools Protocol e inspecionar a aba sob depuração. Conceda essa permissão somente se confiar no código. O navegador exibirá um aviso de depuração durante a execução. A extensão deve ser removida ou desativada após o uso quando não for necessária.

A automação **não deve** alterar status de conclusão, apagar itens ou lidar com credenciais. Não use em tarefas sem autorização. Revise as exigências de segurança da sua organização antes de executar.

## Limitações

- Dependência da estrutura HTML e comportamento da versão atual do Planner.
- Erros transitórios ou atrasos na sincronização podem interromper um lote.
- Não constitui integração oficial com Microsoft Graph.
- O código não executa automaticamente testes end-to-end com contas corporativas.

## Desenvolvimento

Código em JavaScript sem build ou dependências externas. Verifique sintaxe com `node --check painel.js` e `node --check background.js`. Para contribuições, use branches e Pull Requests, descrevendo cenário de teste, comportamento esperado e logs **sem informações corporativas sensíveis**.

## Licença

GPL-3.0 — consulte [LICENSE](LICENSE).

## Correção 4.2.1 — Navegação sem refresh contínuo

A extensão **navega somente ao mudar de Story**. A conferência depois de inserir cada item e a validação final consultam a checklist na aba já aberta, sem repetir `chrome.tabs.update` para a mesma URL. Isso reduz recarregamentos, perda de foco e lentidão.

**Nota de validação:** a leitura sem refresh confirma a presença do item na interface atual, mas não é prova independente de persistência no servidor. Para uma verificação adicional, reabra manualmente a Story depois do lote. Em caso de erro, a rotina pára sem excluir ou duplicar itens.

## Correção 4.2.2 — Erro Failed to fetch

Quando o repositório é clonado, os arquivos com IDs privados **não existem na pasta pública**, pois são ignorados pelo Git. Isso fazia a tela apresentar `Erro de configuração: Failed to fetch` e a lista ficava vazia.

Agora a extensão procura primeiro os dados em `chrome.storage.local`, usa os JSON locais da pasta como alternativa e, se não encontrar, mostra **quais arquivos faltam** com botões para importar os JSON pelo painel. Depois da importação, os dados ficam no perfil do Chrome. Importar novamente substitui a configuração anterior no armazenamento da extensão; não altera cartões no Planner.

Se a extensão for removida e instalada novamente com outro ID, talvez seja necessário importar os arquivos novamente. Mantenha uma cópia segura, fora de um repositório público.

## Correção 4.2.3 — TenantId not found e configuração de exemplo

A versão anterior aceitava um `tid` fictício e um ID de tarefa de exemplo, que levavam a uma tela JSON `TenantId not found`. Agora os campos de importação rejeitam placeholders, validam o formato UUID de `tid` e a navegação **usa o contexto do tenant da aba do Planner que já está autenticada** (em vez de injetar o `tid` do arquivo na URL). A extensão só navega entre Stories, sem fazer refresh em cada item de checklist.

Para usar as 16 Stories reais, importe o pacote **ARAY_Planner_Configuracao_Completa_ZBX.zip** entregue separadamente, contendo `cards.json` e `config.local.json`, no próprio painel. O repositório continua público sem IDs internos da organização. Após atualizar, feche e reabra a aba do painel e, se necessário, recarregue a extensão em `chrome://extensions`.

## Correção 4.2.4 — URL do Planner (rota /ui/web/plan/)

Corrigido o reconhecimento do formato atual `https://planner.cloud.microsoft/ui/web/plan/<planId>/view/board?tid=<tenantId>`, além das rotas legadas `/webui/v1/plan/` e `/webui/plan/`. A extensão conserva o caminho da aba autenticada e somente troca o card ao passar de uma Story para outra, sem recarregar a mesma URL durante a verificação dos checklists.
