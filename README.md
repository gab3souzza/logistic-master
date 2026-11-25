# LogisticMaster — Protótipo operacional

O LogisticMaster foi reorganizado como uma plataforma focada na camada logística das distribuidoras: entrada e normalização de pedidos, cadastro de clientes, frota, cálculo de capacidade, carregamento LIFO, prioridade FEFO, despacho, geolocalização, execução da entrega, ocorrências e logística reversa. O ERP/sistema de vendas continua sendo a origem dos pedidos e documentos fiscais.

A parte financeira do sistema é restrita a **custos operacionais** usados nas simulações logísticas (combustível, equipe, reentrega e reprocessamento). O produto não inclui módulos de cobrança, meios de pagamento ou tesouraria.

## Requisitos

- Node.js 22.5 ou superior (usa o módulo nativo `node:sqlite`; recomendado Node 22.16+).
- npm.
- Conexão com a internet para instalar dependências, geocodificar endereços e usar mapas externos.
- Permissão de geolocalização do navegador; para produção, publique via HTTPS.

## Executar localmente

1. Copie `.env.example` para `.env`.
2. Execute:

```bash
npm install
npm run dev
```

3. Abra `http://localhost:3000`.

O Vite serve a interface e encaminha `/api` para o backend Express na porta 4000. O backend carrega as variáveis de `.env`. Para testar o pacote de produção:

```bash
npm run build
npm start
```

O backend serve a pasta `dist` na porta 4000.

## Acessos de demonstração

Todos os usuários demonstrativos usam a senha `Demo@123`. A tela Configurações permite alterar a senha depois do login.

| Perfil | E-mail |
|---|---|
| Gestor / Proprietário | `gestor@logisticmaster.local` |
| Despachante | `despacho@logisticmaster.local` |
| Motorista | `motorista@logisticmaster.local` |
| Vendedor | `vendas@logisticmaster.local` |

Use o perfil de gestor para inicializar os dados demonstrativos e cadastrar os demais usuários. Troque as senhas de demonstração antes de qualquer utilização com dados reais.

## Persistência e segurança

- Banco SQLite persistente em `server/data/logisticmaster.sqlite` (não versionar nem compartilhar esse arquivo com dados reais). Pedidos, veículos, clientes e rotas são registros JSON tipados na tabela `records`; não é ainda o schema relacional normalizado previsto para produção.
- Senhas derivadas com `scrypt`; sessões aleatórias armazenadas como hash e entregues em cookie `HttpOnly`.
- Perfis `MANAGER`, `DISPATCHER`, `DRIVER` e `SALES_REP`, com autorização no backend.
- Registros associados à distribuidora na estrutura de dados. A versão entregue é preparada para um primeiro ambiente/piloto; ainda exige homologação multi-tenant e migração para PostgreSQL antes de escalar comercialmente.
- Chaves de API guardadas como hash; tokens do WhatsApp ficam somente no servidor.

## PWA do motorista — rota, NF-e e comunicação offline

O perfil `DRIVER` recebe a rota atribuída com clientes na sequência operacional, endereço, janela de recebimento, peso/cubagem e número da NF-e. Na central de Pedidos, use o ícone de arquivo na linha do pedido para anexar o **PDF oficial da DANFE/NF-e** (até 8 MB). O sistema valida o tipo e a assinatura `%PDF-`, armazena o documento vinculado ao pedido e o disponibiliza somente para usuários autorizados da mesma distribuidora; o motorista só pode consultar notas da própria rota ativa.

Quando o motorista abre a rota conectado, o PWA baixa os PDFs anexados para o IndexedDB do aparelho. Depois da sincronização inicial, cada nota pode ser aberta sem internet. Pedidos sem PDF anexado aparecem identificados como `PDF não anexado`. O XML continua sendo utilizado para leitura de dados estruturados e cálculo logístico; **o LogisticMaster não emite nem recria o DANFE oficial**. O documento fiscal precisa vir do ERP/distribuidora.

A tela do motorista também oferece confirmações rápidas (`Cheguei`, `Aguardando`, `Preciso de ajuda` e `Próxima parada`), mensagens curtas para a central, atalho Waze por parada, Google Maps por destino e abertura da sequência no Google Maps. Mensagens, entregas e ocorrências iniciadas sem conexão ficam numa fila local IndexedDB. Cada evento leva um identificador idempotente para reduzir duplicidade no reenvio após reconexão. A página usa Service Worker para manter o shell do PWA disponível após o primeiro carregamento online.

**Preparação de campo:** antes de sair do galpão, o motorista deve abrir a rota enquanto ainda há internet e conferir o indicador `PDFs offline`. O cache é por aparelho/navegador; limpar os dados do site ou trocar de dispositivo remove os documentos armazenados localmente. A sincronização exige reconexão e uma sessão de usuário válida.

## Entrada de pedidos

A tela Pedidos aceita:

1. Cadastro manual.
2. Importação CSV com cabeçalhos como `nfe`, `customerName`, `cnpj`, `address`, `neighborhood`, `city`, `state`, `weightKg`, `volumeM3`, `totalValue`, `timeWindow`, `lat` e `lng`.
3. Importação JSON (objeto, lista ou `{ "orders": [...] }`).
4. XML de NF-e, com extração inicial de destinatário, nota, produtos e tags de rastreabilidade (`nLote`/`dVal`) quando presentes.

Pedidos sem cliente, endereço, peso ou cubagem ficam em complementação. Lotes vencidos são bloqueados; lotes com validade residual de até 65 dias recebem prioridade FEFO. O leitor XML é uma primeira camada e precisa ser homologado com os layouts reais dos fornecedores/ERPs usados pelo cliente.

## API para ERP / sistema de vendas

Crie uma chave em **Integrações** e envie pedidos para:

```http
POST /api/integrations/orders
Content-Type: application/json
X-API-Key: lm_sua_chave
```

Exemplo:

```json
{
  "externalId": "ERP-10456",
  "nfe": "10456",
  "customerName": "Mercadinho Exemplo",
  "cnpj": "00000000000100",
  "address": "Rua Exemplo, 100",
  "neighborhood": "Pituba",
  "city": "Salvador",
  "state": "BA",
  "weightKg": 350,
  "volumeM3": 2.4,
  "totalValue": 2800,
  "timeWindow": "08:00-12:00",
  "items": []
}
```

A API aceita um pedido ou `{ "orders": [...] }`. O campo `externalId` pode ser usado como identificador idempotente do sistema de origem. Campos críticos ausentes deixam o pedido em quarentena.

## WhatsApp Business — Meta Cloud API

A tela Integrações mostra se as credenciais estão configuradas e permite testar um envio. Preencha no `.env` do backend:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET` (validação da assinatura `X-Hub-Signature-256` do webhook)

Webhook: `/api/integrations/whatsapp/webhook`. Mensagens de texto recebidas entram em `pendente_complemento` para conferência humana. O parser semântico por IA e o disparo automático de avisos por ETA ainda não estão habilitados nesta versão. O webhook rejeita eventos sem assinatura válida quando o segredo da aplicação está configurado. A integração real depende de conta empresarial, aplicação Meta, permissões e configuração do webhook.

## Regras operacionais implementadas

- Alocação determinística por peso e cubagem, com teto operacional configurável.
- Prioridade de pedidos reagendados D+1 e lotes FEFO urgentes.
- Sequência de paradas por janela de atendimento; posição física 1 junto à porta do baú.
- Início de rota separado da montagem do carregamento.
- Calculadora Hoje vs. Amanhã no backend, com recomendação por piso de margem e registro de decisão do gestor.
- Entrega integral ou parcial, baixa proporcional de peso/cubagem, assinatura e GPS.
- Geofence de até 30 metros quando existem coordenadas confiáveis do cliente.
- Ocorrência exige motivo, foto e localização.
- Retorno ao galpão com reagendamento D+1 ou baixa por avaria.
- Custo padrão estimado de reentrega: `(km extra ÷ km/L × preço diesel) + (horas × custo equipe)`.
- Geocodificação de endereço por OpenStreetMap Nominatim e navegação externa.
- PWA do motorista com confirmações/mensagens rápidas, fila IndexedDB offline, PDFs oficiais da NF-e em cache por rota, Waze por parada e Google Maps por destino/rota; eventos de entrega e ocorrência usam identificadores idempotentes na sincronização.

## Limitações antes de produção

- A instalação das dependências, build e execução com Vite/Express devem ser concluídas em um ambiente com acesso ao registry npm. Nesta sessão, a instalação expirou; a sintaxe do backend e a transpilação sintática dos arquivos TSX foram verificadas, mas o build completo não foi homologado.
- O banco atual é SQLite para prototipagem; migrar para PostgreSQL e implementar migrations, índices, backups e isolamento multiempresa.
- A heurística de alocação não substitui homologação física do carregamento. Empilhamento por resistência/fragilidade por SKU ainda precisa ser aprofundado.
- O mapa atual é de referência: não há roteirizador geográfico profissional, cálculo de ETA por trânsito, rastreamento contínuo ou polígonos ZRTC da Transalvador homologados.
- A entrega parcial é contabilizada por peso total recusado; a conferência detalhada por SKU/quantidade ainda precisa ser adicionada.
- O modo offline é uma camada de contingência: requer primeiro acesso online, sessão local válida e sincronização da rota/PDFs antes da saída. Conflitos complexos entre ações físicas offline e alterações remotas ainda exigem homologação; não se deve presumir disponibilidade ininterrupta por quatro horas em qualquer aparelho.
- O webhook de WhatsApp precisa ser protegido e homologado em ambiente Meta real antes de receber tráfego de produção.
- Hospede o backend em Node.js com disco persistente; hospedagem estática/serverless com filesystem efêmero não mantém o SQLite.
- Realize testes de segurança, LGPD, retenção de fotos/assinaturas, backups e operação de campo antes do uso comercial.

Consulte `docs/ESPECIFICACAO-DO-PROTOTIPO.md` para a matriz detalhada de escopo, processos, estados e pendências.


---

## Correções aplicadas na V1.2 (Pronta para Hospedagem Teste)

- **Dependências corrigidas (`package.json`):** versões reais e compatíveis (`vite ^6.2.0`, `@vitejs/plugin-react ^4.3.4`, `react ^19.0.0`, `typescript ^5.7.3`).
- **Vínculo de motorista por ID (`driverUserId`):** substitui a comparação frágil por nome em texto; `GET /api/drivers` popula o seletor de motorista na frota.
- **Fila offline sem travamento (`offlineQueue.ts`):** erros `4xx` definitivos (ex.: geofence `422`) são isolados em `failed_mutations` com opção de descarte, sem travar as entregas seguintes; `401` pausa para reautenticação.
- **Preservação de clientes (`retailers`):** novos pedidos/importações preservam coordenadas (`lat/lng`), `avgUnloadMinutes` e `completedDeliveriesCount`.
- **Evidências fora do SQLite + Hash SHA-256 (RN-16) + MMS (RN-13):** assinaturas e fotos de ocorrência são gravadas em disco (`server/data/evidence/`) e consultáveis em `GET /api/orders/:id/evidence/:kind`, mantendo `/api/bootstrap` leve.
- **Webhook WhatsApp multi-tenant e Cancelamento em rota (RN-15):** roteamento por `phone_number_id` e endpoint `POST /api/orders/:id/cancel-in-route` (> 500m vs. ≤ 500m).
- **Deploy pronto (`Dockerfile` + `render.yaml`):** Node 22 garantido (`node:sqlite`), `trust proxy` ativo e `ENABLE_DEMO_USERS=true` liberado para ambiente de teste.

## Como subir em hospedagem teste em 3 minutos (Render.com — Grátis)

1. Extraia o ZIP e suba a pasta `LogisticMaster` para um repositório no seu GitHub.
2. Acesse [render.com](https://render.com) → **New +** → **Blueprint** (ou **Web Service** escolhendo **Docker**).
3. Conecte o repositório: o Render detecta automaticamente o `render.yaml` e o `Dockerfile` (Node 22 + build Vite + Express).
4. Ao finalizar o deploy, abra a URL HTTPS gerada e teste os 4 perfis (`Demo@123`). *(No plano gratuito do Render o disco reinicia após inatividade; para manter o SQLite entre reinícios, basta anexar um Persistent Disk em `/app/server/data` ou migrar para PostgreSQL.)*
