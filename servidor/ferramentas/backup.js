import { encerrarBanco, iniciarBanco } from '../nucleo/banco.js';
import { fazerBackup, listarBackups } from '../nucleo/backup.js';

/**
 * Copia de seguranca sob demanda: `npm run backup`.
 *
 * O sistema ja copia sozinho ao subir e uma vez por dia. Esta ferramenta e
 * para o momento em que se vai mexer em algo grande e se quer a copia de
 * ANTES, com nome dizendo o motivo:
 *
 *   npm run backup -- --motivo antes-da-migracao
 *
 * Pode rodar com o sistema no ar: ela le os mesmos arquivos e forca a gravacao
 * do que estava pendente antes de copiar.
 */
const argumentos = process.argv.slice(2);
const indice = argumentos.indexOf('--motivo');
const motivo = (indice >= 0 && argumentos[indice + 1] ? argumentos[indice + 1] : 'manual').replace(/[^\w-]+/g, '-');

await iniciarBanco();
const relato = fazerBackup({ motivo });

console.log(`Copia feita: ${relato.nome}`);
console.log(`  pasta:     ${relato.caminho}`);
console.log(`  copiados:  ${relato.arquivos} arquivos (${(relato.bytes / 1048576).toFixed(1)} MB)`);
console.log(`  ligados:   ${relato.ligados} arquivos de midia (sem gastar disco)`);
if (relato.apagados.length) console.log(`  apagadas:  ${relato.apagados.join(', ')}`);

console.log('\nCopias guardadas:');
for (const b of listarBackups()) console.log(`  ${b.nome}`);

await encerrarBanco();
process.exit(0);
