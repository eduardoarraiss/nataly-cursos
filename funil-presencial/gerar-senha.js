/* Gera uma senha forte para o painel /crm.
   Uso: node funil-presencial/gerar-senha.js
   A senha NÃO é gravada em lugar nenhum — copie e cole na variável
   de ambiente CRM_SENHA (no Railway e no seu .env local). */
const crypto = require('crypto');
const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.';
let senha = '';
while (senha.length < 24) {
  const b = crypto.randomBytes(1)[0];
  if (b < 256 - (256 % alfabeto.length)) senha += alfabeto[b % alfabeto.length];
}
console.log('\nCRM_SENHA=' + senha + '\n');
console.log('Guarde no gerenciador de senhas. Ela não fica salva aqui.\n');
