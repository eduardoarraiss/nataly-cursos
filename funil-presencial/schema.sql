-- ============================================================
-- FUNIL DE QUALIFICAÇÃO — Profissão Lash Online + Presencial
-- Nataly Ribeiro · Cambuí, MG · quatro produtos, roteados por árvore de decisão
-- (ver funil-presencial/produtos.js)
--
-- Banco PRÓPRIO da Nataly. Não tem relação nenhuma com a Haus,
-- com o Roberta OS nem com o haus-comercial-crm.
--
-- Idempotente: pode rodar quantas vezes quiser (CREATE ... IF NOT EXISTS).
-- ============================================================

-- ---------- 1. LEADS ----------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                BIGSERIAL PRIMARY KEY,
  criado_em         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- ---- identificação ----
  -- 🔴 SÓ nome e telefone são NOT NULL, e é de propósito: eles são o GATILHO
  -- da gravação parcial (02/09/2026). Quem abandona no meio do formulário
  -- ainda não digitou o Instagram nem disse se vem a Cambuí — exigir esses
  -- campos no banco tornaria impossível guardar justamente o lead que a
  -- Nataly mais quer alcançar. A obrigatoriedade do lead COMPLETO continua
  -- existindo, mas onde ela pertence: em `valida()`, no leads.js.
  nome              TEXT         NOT NULL,
  telefone          TEXT         NOT NULL,   -- só dígitos, com DDI 55
  telefone_exibicao TEXT,                    -- como a pessoa digitou
  email             TEXT,
  instagram         TEXT,                    -- sem @, minúsculo
  cidade            TEXT,
  estado            TEXT,                    -- UF
  faixa_idade       TEXT,                    -- '18-24' | '25-34' | '35-44' | '45+'

  -- ---- qualificação declarada ----
  situacao          TEXT,        -- 'ja-lash' | 'area-beleza' | 'outra-area'
  busca             TEXT,        -- só quem já é lash: 'aperfeicoar-cilios'|'tecnica-led'|'nao-sei'
  meta_renda        TEXT,        -- faixa de renda desejada
  objetivo          TEXT,        -- texto livre: o que ela quer com o curso
  disponibilidade   TEXT,                    -- 'sim' | 'talvez' | 'nao'
  prefere_formato   TEXT,        -- 'presencial' | 'online' | 'nao-sei'
  faixa_investimento TEXT,       -- 'ate-500'|'500-1500'|'1500-2000'|'acima-2000'|'depende-parcelamento'
  aceita_valor      TEXT,                    -- derivado da faixa: 'sim'|'preciso-parcelar'|'nao'
  quando_comecar    TEXT,        -- 'agora' | '30-dias' | '90-dias' | 'so-olhando'

  -- ---- o que a árvore decidiu ----
  -- Sem isto não dá para auditar o roteamento depois: a regra muda com o
  -- tempo, e um lead de setembro precisa continuar dizendo para qual produto
  -- ELE foi mandado, com a regra que valia no dia.
  produto_id        TEXT,        -- 'profissao-lash'|'profissao-lash-presencial'|'lash2-online'|'lash2-presencial'
  produto_nome      TEXT,        -- nome legível, como apareceu para ela
  produto_formato   TEXT,        -- 'online' | 'presencial'
  produto_valor     INTEGER,     -- o preço que ELA viu, em reais
  recomendacao_motivos TEXT,     -- por que a árvore decidiu assim (uma frase por linha)

  -- ---- qualificação calculada ----
  pontuacao         INTEGER      NOT NULL DEFAULT 0,
  qualificacao      TEXT         NOT NULL DEFAULT 'frio',  -- 'quente'|'morno'|'frio'

  -- ---- parcial x completo (02/09/2026) ----
  -- O lead passa a ser gravado ASSIM QUE HÁ CONTATO UTILIZÁVEL (nome +
  -- WhatsApp válido), e não só no envio final. Quem se assusta com o preço e
  -- fecha a aba deixava de existir — e some justamente quem chegou perto de
  -- comprar. `completo` separa os dois mundos; `ultima_etapa` diz ONDE parou.
  completo          BOOLEAN      NOT NULL DEFAULT false,
  ultima_etapa      TEXT,        -- '1'..'10' (a etapa que ela estava vendo)
  avisado_parcial_em TIMESTAMPTZ, -- quando o aviso de incompleto saiu (uma vez só)

  -- ---- pipeline ----
  status            TEXT         NOT NULL DEFAULT 'novo',
  -- novo → contatado → em-conversa → proposta-enviada → ganho | perdido
  anotacao          TEXT,

  -- ---- origem / atribuição ----
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  utm_content       TEXT,
  utm_term          TEXT,
  fbclid            TEXT,
  gclid             TEXT,
  referrer          TEXT,
  pagina            TEXT,        -- rota de origem
  user_agent        TEXT,
  ip                TEXT,
  ip_regiao         TEXT,        -- preenchido depois, se quiser

  -- ---- antifraude / dedupe ----
  lead_uid          TEXT UNIQUE  -- eventID do navegador, dedupe de duplo envio
);

CREATE INDEX IF NOT EXISTS idx_leads_criado      ON leads (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_qualif      ON leads (qualificacao);
CREATE INDEX IF NOT EXISTS idx_leads_utm_content ON leads (utm_content);
CREATE INDEX IF NOT EXISTS idx_leads_utm_camp    ON leads (utm_campaign);
CREATE INDEX IF NOT EXISTS idx_leads_cidade      ON leads (cidade);
CREATE INDEX IF NOT EXISTS idx_leads_telefone    ON leads (telefone);

-- ---------- 1b. MIGRAÇÃO — a árvore de decisão (01/09/2026) ----
-- O CREATE TABLE acima só vale para banco novo. O de produção já existe,
-- então as colunas da árvore entram por ALTER. IF NOT EXISTS mantém o
-- arquivo idempotente: roda em todo boot sem quebrar nada.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS busca                TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS prefere_formato      TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS faixa_investimento   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_id           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_nome         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_formato      TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto_valor        INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recomendacao_motivos TEXT;

-- ---------- 1c. MIGRAÇÃO — captura parcial do lead (02/09/2026) ----
-- 🔴 A LIÇÃO DE 01/09/2026 VALE AQUI TAMBÉM, e por isso estes ALTER vêm
--    ANTES do bloco de índices lá embaixo: em banco que JÁ EXISTE a coluna só
--    nasce no ALTER, e um índice sobre ela colocado antes derruba o arquivo
--    INTEIRO — nenhuma coluna é criada e toda inserção de lead quebra.
--    Índice sobre coluna nova: SEMPRE depois de todos os ALTER.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS completo           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ultima_etapa       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS avisado_parcial_em TIMESTAMPTZ;

-- As colunas que eram NOT NULL e não podem mais ser: o parcial nasce com
-- nome e telefone e mais nada. DROP NOT NULL é idempotente — rodar de novo
-- em coluna que já é anulável não faz nada e não dá erro.
ALTER TABLE leads ALTER COLUMN instagram       DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN cidade          DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN disponibilidade DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN aceita_valor    DROP NOT NULL;

-- 🔴 Este backfill roda A CADA BOOT (o schema inteiro roda a cada boot), então
--    ele PRECISA saber distinguir um lead antigo de um parcial vivo — senão o
--    primeiro restart marcaria como COMPLETO todo mundo que estava no meio do
--    formulário, e o aviso de incompleto nunca sairia.
--    O que separa os dois: todo lead gravado antes de 02/09/2026 chegou pelo
--    envio final (logo TEM produto indicado) e nunca escreveu `ultima_etapa`.
--    Todo parcial escreve `ultima_etapa` e não tem produto. As duas condições
--    juntas são a trava.
UPDATE leads SET completo = true
 WHERE completo = false
   AND ultima_etapa IS NULL
   AND produto_id IS NOT NULL;

-- 🔴 Este indice VIVE AQUI, depois dos ALTER, e nao junto dos outros indices.
--    Em banco NOVO o CREATE TABLE ja traz produto_id e a ordem nao importa.
--    Em banco que JA EXISTE a coluna so nasce no ALTER acima — o indice antes
--    dele falha com 'column "produto_id" does not exist' e, como a migracao roda
--    o arquivo inteiro de uma vez, ABORTA TUDO: nenhuma das oito colunas novas
--    e criada e toda insercao de lead passa a quebrar.
--    Foi exatamente o que aconteceu em 01/09/2026.
CREATE INDEX IF NOT EXISTS idx_leads_produto ON leads (produto_id);

-- Mesma regra, mesma posição: depois dos ALTER. O painel abre filtrando por
-- completo, e a varredura do aviso de incompleto procura parcial parado —
-- os dois passam por aqui em toda visita.
CREATE INDEX IF NOT EXISTS idx_leads_completo  ON leads (completo, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_parcial   ON leads (completo, avisado_parcial_em, atualizado_em);

-- Os leads gravados ANTES da árvore existiam num mundo de um produto só:
-- o Profissão Lash online + presencial (R$ 1.497). Marcá-los assim é
-- verdade histórica, e sem isso o filtro por produto no painel esconderia
-- todos eles atrás de um "(sem produto)".
UPDATE leads SET produto_id = 'profissao-lash-presencial',
                 produto_nome = 'Profissão Lash — online + presencial',
                 produto_formato = 'presencial',
                 produto_valor = 1497
 WHERE produto_id IS NULL
   -- 🔴 E NUNCA um parcial: quem parou na pergunta 4 não foi "indicada para o
   --    presencial de R$ 1.497" — ela não chegou nem perto da pergunta que
   --    decide isso. Carimbar produto nela seria inventar um dado comercial.
   AND completo = true;

-- ---------- 2. HISTÓRICO DE STATUS --------------------------
-- Toda mudança de status vira uma linha aqui. Nunca se apaga:
-- é o registro de como o lead andou no funil.
CREATE TABLE IF NOT EXISTS leads_historico (
  id           BIGSERIAL PRIMARY KEY,
  lead_id      BIGINT       NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  criado_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  de_status    TEXT,
  para_status  TEXT         NOT NULL,
  anotacao     TEXT,
  autor        TEXT                     -- quem mexeu (usuário do painel)
);

CREATE INDEX IF NOT EXISTS idx_hist_lead ON leads_historico (lead_id, criado_em DESC);

-- ---------- 3. FILA DE AVISOS (WhatsApp) --------------------
-- O lead é gravado ANTES de qualquer tentativa de envio. Se o WhatsApp
-- estiver fora do ar, o aviso fica aqui em 'pendente' e é retentado.
-- Nenhum lead se perde por falha de envio.
CREATE TABLE IF NOT EXISTS avisos (
  id            BIGSERIAL PRIMARY KEY,
  lead_id       BIGINT       NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now(),
  canal         TEXT         NOT NULL DEFAULT 'whatsapp',
  -- 'lead' = inscrição completa · 'parcial' = alguém que parou no meio.
  -- Separado para o painel poder dizer qual aviso é qual, e para o gate poder
  -- provar que o parcial não vira aviso de lead pronto.
  tipo          TEXT         NOT NULL DEFAULT 'lead',
  destino       TEXT,                                  -- número ou id de grupo
  mensagem      TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'pendente', -- pendente|enviado|falhou
  tentativas    INTEGER      NOT NULL DEFAULT 0,
  proxima_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),    -- backoff
  ultimo_erro   TEXT,
  enviado_em    TIMESTAMPTZ
);

ALTER TABLE avisos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'lead';

CREATE INDEX IF NOT EXISTS idx_avisos_pendentes ON avisos (status, proxima_em);
CREATE INDEX IF NOT EXISTS idx_avisos_lead      ON avisos (lead_id);

-- ---------- 4. SESSÕES DO PAINEL ----------------------------
-- Sessão do /crm guardada no banco (não é cookie autoassinado solto):
-- dá para revogar e expira sozinha.
CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  usuario    TEXT         NOT NULL,
  criada_em  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expira_em  TIMESTAMPTZ  NOT NULL,
  ip         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessoes_exp ON sessoes (expira_em);

-- ---------- 5. TENTATIVAS DE LOGIN --------------------------
-- Freio de força bruta no /crm. Dados pessoais reais de terceiros
-- estão do outro lado dessa senha.
CREATE TABLE IF NOT EXISTS login_tentativas (
  id        BIGSERIAL PRIMARY KEY,
  ip        TEXT        NOT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  sucesso   BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_login_ip ON login_tentativas (ip, criada_em DESC);
