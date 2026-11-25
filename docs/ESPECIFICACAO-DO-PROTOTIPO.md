# LogisticMaster — Especificação revisada do protótipo

**Versão:** 1.1-prototype  
**Revisão:** 24 de novembro de 2026  
**Base documental:** Documento Mestre de Processos, Regras de Negócio e Arquitetura de Engenharia (2ª Unidade) e Memória de Engenharia e Requisitos (2ª Unidade).

## 1. Definição do produto

O LogisticMaster é uma plataforma operacional para pequenas distribuidoras. Seu trabalho começa quando o pedido precisa ser preparado para expedição e termina quando a entrega ou a devolução física é registrada.

**Responsabilidade central:** organizar pedidos, clientes, frota, capacidade, carregamento, sequência de paradas, deslocamento, confirmação de entrega, evidências e logística reversa.

Não pretende substituir o ERP, o faturamento, o estoque comercial ou o sistema de vendas do distribuidor. Esses sistemas continuam sendo a origem dos pedidos e dos documentos; o LogisticMaster recebe seus dados e executa a camada logística.

## 2. Perfis e permissões

| Perfil | Responsabilidade | Áreas principais |
|---|---|---|
| `MANAGER` | Dono/gestor; visão geral e decisões de operação | Dashboard do proprietário, pedidos, clientes, frota, despacho, mapa, integrações, usuários e parâmetros |
| `DISPATCHER` | Preparar e acompanhar expedição | Pedidos, clientes, frota, despacho e mapa |
| `DRIVER` | Executar rota e registrar eventos físicos | Aplicativo/PWA do motorista, navegação, GPS, assinatura, entrega e ocorrência |
| `SALES_REP` | Alimentar a operação com pedidos e clientes | Entrada e consulta de pedidos e clientes |

A autorização é aplicada no backend. Esconder uma tela na interface não é tratado como controle de segurança suficiente.

## 3. Processos operacionais contemplados

### PN-01 — Entrada e validação de pedidos

Canais disponíveis no protótipo:

- Cadastro manual na Central de Pedidos.
- Importação de planilhas CSV.
- Importação de JSON.
- Leitura inicial de XML de NF-e, incluindo destinatário, produtos e tags de lote/validade quando disponíveis.
- Entrada externa por API REST com chave individual.
- Recepção de mensagens pelo webhook do WhatsApp Business, direcionadas à fila de complementação.

Dados críticos ausentes colocam o pedido em `pendente_complemento`. Lotes vencidos são classificados para `bloqueio_fiscal`; lotes com até 65 dias de validade residual recebem prioridade FEFO.

### PN-02 — Alocação e carregamento

O motor de despacho executa no backend. Considera pedidos `pendente` ou `reagendado_d1`, capacidade máxima de peso e cubagem, limite operacional configurável, prioridade de reagendamento, validade FEFO e janela de recebimento.

A ordem física de carregamento segue a sequência LIFO documentada: a primeira parada da rota fica na posição 1, junto à porta do baú; as entregas seguintes avançam em direção ao fundo/cabine. O protótipo apresenta a sequência de paradas por veículo e exige confirmação de saída antes de mudar os pedidos para `em_rota`.

### PN-03 — Decisão Hoje vs. Amanhã

A calculadora compara:

- Custo adicional hoje: combustível por quilômetros extras + custo de equipe por horas adicionais + frete avulso.
- Custo incremental previsto para D+1.
- Margem bruta informada para o pedido.
- Piso de margem operacional parametrizado.

O backend executa a equação e retorna a recomendação. O gestor pode registrar a consolidação D+1 ou forçar o despacho imediato quando a recomendação for adiar. O sistema não calcula a margem comercial do ERP: ela é informada na simulação.

### PN-04 — Geolocalização e comunicação

O protótipo oferece geocodificação de endereços via OpenStreetMap Nominatim, captura de GPS no aparelho do motorista, registro da localização do veículo e abertura de navegação externa.

O envio e recebimento de mensagens está preparado para a Meta WhatsApp Cloud API. O canal depende de credenciais reais e configuração de webhook. A regra de atraso superior a 15 minutos está parametrizada, mas o monitoramento contínuo de tráfego/ETA e o disparo automático por evento ainda não estão concluídos.

### PN-05 — Entrega e ocorrência

O motorista consulta suas paradas, abre a navegação e registra:

- Entrega integral com nome/documento do recebedor, assinatura desenhada na tela e GPS.
- Entrega parcial com peso recusado e foto de evidência.
- Ocorrência com motivo padronizado, foto obrigatória e GPS.

Quando as coordenadas do cliente estão cadastradas, o backend valida o raio de geofence configurado (padrão de 30 metros). Sem coordenadas confiáveis, o registro de GPS do aparelho fica salvo, mas a distância até o cliente não pode ser comprovada.

### PN-05.1 — PWA do motorista, documentos fiscais e comunicação rápida offline

O PWA é o romaneio digital da rota atribuída. Exibe os clientes na sequência de descarga, endereços, janelas, peso/cubagem e número da NF-e. A Central de Pedidos permite anexar o PDF oficial da DANFE ao respectivo pedido (máximo de 8 MB). O arquivo fica associado à distribuidora e ao pedido; a leitura no PWA é autorizada somente para o motorista vinculado à rota ativa.

Na primeira abertura da rota com conexão, o PWA baixa os PDFs anexados para o IndexedDB do dispositivo. Após essa sincronização, o motorista pode abrir a NF-e sem internet. O sistema não emite nem reconstrói o DANFE a partir do XML; o PDF oficial deve ser fornecido pelo ERP/distribuidora. A importação de XML segue independente para extração de dados, itens, lotes e cálculos FEFO.

O canal operacional oferece ações de um toque (`Cheguei`, `Aguardando`, `Preciso de ajuda` e `Próxima parada`) e mensagem curta para a Central de Despacho. Sem rede, mensagens, baixas e ocorrências são enfileiradas no IndexedDB com `clientEventId` idempotente e reenviadas quando houver conexão e sessão válida. A Central recebe novas mensagens por atualização periódica. O motorista pode abrir o Waze para cada parada, abrir o Google Maps para um destino e solicitar a sequência de rota no Google Maps.

Pré-condição operacional: a rota e seus documentos devem ser sincronizados no galpão antes da saída. O Service Worker mantém o shell da aplicação após o primeiro acesso online; limpar os dados do navegador remove o cache local.

### PN-06 — Logística reversa

Pedidos com ocorrência ou fração recusada permanecem associados à carga até o retorno. A Central de Despacho permite classificar o retorno como:

- `reagendado_d1`: produto íntegro reintegrado e priorizado para o próximo dia.
- `baixado_avaria`: produto segregado por avaria.

A conferência reversa atualiza peso e cubagem do veículo e encerra a rota quando todas as paradas estiverem resolvidas.

## 4. Máquina de estados

| Estado | Significado |
|---|---|
| `pendente_complemento` | Falta informação necessária para planejar a entrega |
| `bloqueio_fiscal` | Lote vencido ou divergência que impede expedição |
| `pendente` | Pedido validado e aguardando despacho |
| `alocado_no_bau` | Pedido alocado e com posição física definida |
| `em_rota` | Caminhão saiu e a entrega pode ser executada |
| `cancelado_em_rota` | Parada suspensa; mercadoria ainda precisa ser reconciliada no retorno |
| `entregue` | Entrega integral confirmada |
| `entregue_parcial` | Parte entregue; fração recusada permanece sob custódia física |
| `ocorrencia` | Entrega não realizada; carga aguarda conferência no galpão |
| `reagendado_d1` | Mercadoria íntegra retornou e foi priorizada para D+1 |
| `baixado_avaria` | Estado operacional adicional do protótipo após baixa por avaria |

## 5. Dados e persistência

A versão entregue usa SQLite persistente (`server/data/logisticmaster.sqlite`) para permitir instalação local simples. A estrutura contém tabelas próprias para distribuidoras, usuários, sessões, parâmetros, chaves de integração e eventos; os objetos operacionais (pedidos, veículos, clientes e rotas) são armazenados como registros tipados em uma tabela genérica `records`, com o payload em JSON e associação à distribuidora.

O documento de engenharia prevê PostgreSQL, DDL relacional normalizado, PL/pgSQL e testes pgTAP. A versão atual ainda não migrou para PostgreSQL nem criou tabelas normalizadas de itens/entregas/ocorrências: o armazenamento SQLite é uma escolha de prototipagem, não a decisão final para produção ou múltiplos clientes. A hospedagem de produção precisa oferecer processo Node.js e disco persistente; hospedagem estática/serverless com filesystem efêmero não serve para este armazenamento.

## 6. Integrações

### ERP, sistema de vendas e outros sistemas logísticos

Endpoint: `POST /api/integrations/orders`  
Autenticação: cabeçalho `X-API-Key`.  
Formato: JSON com um pedido ou uma lista em `{ "orders": [...] }`.

A chave é criada no painel de Integrações, exibida uma única vez e guardada no banco apenas como hash. O fornecedor do sistema de origem precisa mapear os campos para o contrato publicado no README.

### Arquivos

CSV, JSON e XML de NF-e podem ser importados pelo painel. A importação não substitui validação fiscal oficial nem garante que todos os layouts proprietários de ERP sejam idênticos.

### WhatsApp

A integração usa WhatsApp Business Platform — Meta Cloud API. Configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` e `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` no `.env` do backend. O webhook POST valida `X-Hub-Signature-256` antes de aceitar mensagens. As mensagens recebidas entram em quarentena para conferência humana; o parser semântico por IA ainda não foi habilitado.

## 7. Regras excluídas do escopo

O LogisticMaster não terá módulo de recebimento de valores, cobrança, meios de pagamento, custódia de numerário ou tesouraria. A parte monetária existente se limita aos custos logísticos usados nos cálculos de combustível, equipe, reentrega e reprocessamento.

Também permanecem fora do escopo atual a telemetria CAN-BUS e o rastreamento por satélite proprietário, conforme a priorização de requisitos do documento mestre.

## 8. Matriz de prontidão do protótipo

| Recurso | Situação na versão entregue |
|---|---|
| Login, sessão e perfis | Implementado para ambiente de demonstração; troca de senha disponível |
| Dashboard do proprietário | Implementado com contagens e capacidade derivadas dos dados atuais |
| Cadastro de usuários | Implementado pelo perfil gestor |
| Banco persistente | Implementado em SQLite com `records` JSON para objetos operacionais; normalização e migração PostgreSQL pendentes |
| Cadastro e importação de pedidos | Implementado (manual, CSV, JSON e leitor básico de XML NF-e) |
| API de entrada externa | Implementada com API keys |
| Entrada WhatsApp | Webhook preparado; depende de configuração Meta e revisão do payload em ambiente real |
| Alocação peso/cubagem | Implementada com heurística determinística de alocação |
| FEFO | Implementado no processamento dos itens importados com validade |
| Sequência LIFO por parada | Implementada e exibida na central e no aplicativo do motorista |
| Camada pesada/base e frágil/topo | Ainda não validada como algoritmo de empilhamento físico por SKU |
| Calculadora Hoje vs. Amanhã | Implementada no backend e associada à decisão do pedido |
| Geocodificação e GPS | Implementados; dependem de internet/permissão e revisão de coordenadas |
| Geofence de entrega | Implementado quando existem coordenadas de cliente |
| Baixa integral e parcial | Implementada; a parcial usa peso recusado agregado, não reconciliação detalhada por SKU |
| Foto, assinatura e ocorrência | Implementadas como evidência do protótipo |
| Logística reversa | Implementada para reagendamento D+1 ou baixa por avaria |
| Mapa com roteamento/ETA de tráfego | Parcial: mapa de referência, geocodificação e navegação externa; sem solver viário/tráfego em tempo real |
| Notificação automática por atraso | Pendente; há conexão manual com WhatsApp e parâmetros de atraso |
| PWA offline e comunicação | Implementado como contingência inicial: shell via Service Worker, snapshot local, confirmações/mensagens e ações de entrega/ocorrência em fila IndexedDB com idempotência; conflitos complexos ainda exigem homologação |
| PDF oficial da NF-e no PWA | Implementado: central anexa PDF ao pedido; arquivo é autorizado por tenant/rota e sincronizado no IndexedDB do motorista para consulta offline |
| Navegação Waze / Google Maps | Implementada: Waze por parada, Google Maps por destino e link de rota completa respeitando a sequência |
| ZRTC de Salvador | Pendente de base oficial de polígonos e regras horárias verificadas |
| Multiempresa em produção | Estrutura de tenant preparada, onboarding e isolamento/homologação completos pendentes |

## 9. Próximos marcos recomendados

1. Instalar dependências em ambiente com acesso ao registry npm e executar build, lint e smoke tests.
2. Migrar persistência de protótipo para PostgreSQL, adicionar migrations, backups, isolamento multi-tenant e testes de concorrência.
3. Homologar o algoritmo de carregamento no galpão, incluindo resistência/fragilidade por SKU e conferência por volumes reais.
4. Implementar roteirização geográfica real (matriz de distâncias, janelas, restrições de veículos e trânsito) e monitoramento ETA.
5. Homologar PWA offline em aparelhos reais, sincronização idempotente, conflitos, cache de PDFs e evidências em armazenamento de objetos.
6. Configurar a Meta Cloud API, validar assinatura do webhook e testar templates, limites e consentimento de mensagens.
7. Completar auditoria de segurança, LGPD, logs, permissões, retenção de dados e recuperação de desastres antes de uso comercial.

---

**Observação importante:** esta versão é um protótipo operacional funcional para validação dos fluxos centrais. Não deve ser tratada como sistema de produção até que os itens pendentes sejam testados e homologados em operação real.
