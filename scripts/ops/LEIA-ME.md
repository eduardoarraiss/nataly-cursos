# Ops do WhatsApp da Nataly (Evolution)

## Reparear (quando a instância cai)
```bash
bash scripts/ops/parear-whatsapp.sh      # gera o QR e abre a imagem
bash scripts/ops/estado-whatsapp.sh      # confirma: precisa dizer "open"
```
No celular: **WhatsApp > Aparelhos conectados > Conectar aparelho** e escaneie.
O QR **expira em ~40 segundos** e rotaciona — rode o script e escaneie na hora.

Em 04/09/2026, às 12h23 (Brasília), a instância caiu com `device_removed`:
alguém removeu o aparelho pareado pelo próprio WhatsApp. O número que estava
pareado era `5511943409393`. Enquanto ela fica em `close`/`connecting`, o lead
é gravado no banco normalmente e **ninguém é avisado** — o site não quebra, o
aviso é que some, em silêncio.

## Reenviar o resumo consolidado de leads para o grupo
```bash
export CRM_USER=... CRM_PASS=...        # conta do /crm
export WAURL=... WAKEY=...              # railway variables list --service cursos --kv
node scripts/ops/enviar-resumo-leads.js            # só monta e mostra
node scripts/ops/enviar-resumo-leads.js --enviar   # envia de verdade
```
Ele **recusa enviar** se a instância não estiver `open`, e confirma o envio
pelo **id da mensagem** que a API devolve — nunca pelo código de status.
A lista de leads sai do banco de produção; os ids reais estão em `IDS_REAIS`.
