#!/usr/bin/env node
/*
 * Um whisper-cli de mentira, so para conferir a emenda.
 *
 * Nao reconhece fala nenhuma: le os argumentos como o de verdade leria, confere
 * que o WAV existe, e grava o MESMO JSON que o whisper.cpp grava (conferido na
 * fonte: examples/cli/cli.cpp, start_arr("transcription") + offsets em ms).
 *
 * O que isto testa e justamente o que eu nao posso testar sem o binario:
 * se os argumentos saem na ordem certa, se o arquivo .json e procurado no
 * lugar certo e se a leitura do formato esta correta.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log('falso whisper-cli');
  process.exit(0);
}

const valor = (bandeira) => {
  const i = args.indexOf(bandeira);
  return i >= 0 ? args[i + 1] : null;
};

const modelo = valor('-m');
const arquivo = valor('-f');
const idioma = valor('-l');

if (!modelo || !fs.existsSync(modelo)) {
  console.error('modelo nao encontrado: ' + modelo);
  process.exit(1);
}
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error('audio nao encontrado: ' + arquivo);
  process.exit(1);
}
if (idioma !== 'pt') {
  console.error('esperava -l pt, veio: ' + idioma);
  process.exit(1);
}
if (!args.includes('-oj')) {
  console.error('faltou -oj; sem ele o de verdade nao grava json');
  process.exit(1);
}

/* O WAV precisa ser 16 kHz mono PCM — e o que o whisper exige. Conferimos pelo
   cabecalho RIFF, porque mandar outro formato e um erro que passaria calado. */
const cabeca = fs.readFileSync(arquivo).subarray(0, 44);
const canais = cabeca.readUInt16LE(22);
const taxa = cabeca.readUInt32LE(24);
if (cabeca.toString('ascii', 0, 4) !== 'RIFF') {
  console.error('nao e WAV');
  process.exit(1);
}
if (canais !== 1 || taxa !== 16000) {
  console.error(`esperava 16000 Hz mono, veio ${taxa} Hz / ${canais} canal(is)`);
  process.exit(1);
}

const saida = {
  systeminfo: 'falso',
  model: { type: 'base' },
  params: { model: modelo, language: idioma },
  transcription: [
    { timestamps: { from: '00:00:00,000', to: '00:00:06,000' }, offsets: { from: 0, to: 6000 }, text: ' Doutor, bom dia. Meu nome e Rosangela Vieira da Silva.' },
    { timestamps: { from: '00:00:06,000', to: '00:00:14,000' }, offsets: { from: 6000, to: 14000 }, text: ' O numero do meu beneficio e 623-456-78.' },
    { timestamps: { from: '00:00:14,000', to: '00:00:18,000' }, offsets: { from: 14000, to: 18000 }, text: ' A pericia foi dia 12 de agosto.' },
    /* Repetido de proposito: o de verdade sobrepoe janelas, e juntarTrechos
       precisa jogar fora o que nao avanca o relogio. */
    { timestamps: { from: '00:00:14,000', to: '00:00:18,000' }, offsets: { from: 14000, to: 18000 }, text: ' A pericia foi dia 12 de agosto.' },
    { timestamps: { from: '00:00:18,000', to: '00:00:21,000' }, offsets: { from: 18000, to: 21000 }, text: ' O INCSS negou o pedido.' },
  ],
};

fs.writeFileSync(`${arquivo}.json`, JSON.stringify(saida, null, 2));
