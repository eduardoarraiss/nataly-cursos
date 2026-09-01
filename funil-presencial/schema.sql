-- ============================================================
-- FUNIL DE QUALIFICAÇÃO — Profissão Lash Online + Presencial
-- Nataly Ribeiro · Cambuí, MG · R$ 1.497
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
  nome              TEXT         NOT NULL,
  telefone          TEXT         NOT NULL,   -- só dígitos, com DDI 55
  telefone_exibicao TEXT,                    -- como a pessoa digitou
  email             TEXT,
  instagram         TEXT         NOT NULL,   -- sem @, minúsculo
  cidade            TEXT         NOT NULL,
  estado            TEXT,                    -- UF
  faixa_idade       TEXT,                    -- '18-24' | '25-34' | '35-44' | '45+'

  -- ---- qualificação declarada ----
  situacao          TEXT,        -- 'ja-lash' | 'area-beleza' | 'outra-area'
  meta_renda        TEXT,        -- faixa de renda desejada
  objetivo          TEXT,        -- texto livre: o que ela quer com o curso
  disponibilidade   TEXT         NOT NULL,   -- 'sim' | 'talvez' | 'nao'
  aceita_valor      TEXT         NOT NULL,   -- 'sim' | 'preciso-parcelar' | 'nao'
  quando_comecar    TEXT,        -- 'agora' | '30-dias' | '90-dias' | 'so-olhando'

  -- ---- qualificação calculada ----
  pontuacao         INTEGER      NOT NULL DEFAULT 0,
  qualificacao      TEXT         NOT NULL DEFAULT 'frio',  -- 'quente'|'morno'|'frio'

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
  destino       TEXT,                                  -- número ou id de grupo
  mensagem      TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'pendente', -- pendente|enviado|falhou
  tentativas    INTEGER      NOT NULL DEFAULT 0,
  proxima_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),    -- backoff
  ultimo_erro   TEXT,
  enviado_em    TIMESTAMPTZ
);

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
