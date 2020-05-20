import parse = require('csv-parse');
import path = require( 'path');

// tslint:disable-next-line:no-var-requires
const mathml: any = require('mathml');
import fs = require('fs');
import xmlDom = require('xmldom');
import xpath = require('xpath');
import { ArqRecord } from './arqRecord';
import Promise = require('bluebird');
import debug = require('debug');

const log = debug('arq2hrvst');
const vlog = debug('verbose');
const afs = Promise.promisifyAll(fs);


// let converted = 0;

const minimize = (mml: any) =>
  mathml(mml)
    .toMinimalPmml('all').toString();


function writeFile(outPath: string, data: string, options: {} = { encoding: 'utf8', flag: 'a' }) {
  // @ts-ignore
  return afs.writeFileAsync(outPath, data, options).then(() => vlog('wrote to file'));
}

export function extract(mml: string, url: string, postId: number) {
  const parser = new xmlDom.DOMParser();
  const parsed = parser.parseFromString(mml);
  const select = xpath.useNamespaces({ 'm': 'http://www.w3.org/1998/Math/MathML' });
  const nodes = select('//m:math', parsed);
  let output = '';
  if (nodes.length) {
    nodes.forEach(n => output += `<mws:expr url="${url}" data-post-id="${postId}">\n${minimize(n)}\n</mws:expr>`);
  }
  return output;
}

const processFile = (inFile: string, outFile: string) => {
  const inStream = fs.createReadStream(inFile);
  const parser = parse({ columns: true, cast: true, delimiter: '\t' });
  const iterable = {
    [Symbol.iterator]() {
      // noinspection JSUnusedGlobalSymbols
      return {
        next() {
          const record = parser.read();
          if (record) {
            return { value: record, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
  const dataset: Map<number, ArqRecord> = new Map();
  const collection = path.basename(inFile);
  let recordSize = 0;
  parser.on('readable', () => {
    let blockSize = 0;
    return Promise.map(iterable, (entry: ArqRecord) => {
      ++blockSize;
      try {
        if (entry.formula)
          return extract(entry.formula, String(entry.id), entry.post_id);
        log('No formula in line %o', recordSize + blockSize, entry.formula);
      } catch (e) {
        log('Problem in line %o: %O', recordSize + blockSize, entry.formula);
      }
    }, { concurrency: 1000 }).reduce((all, next) => all + next, '')
      .then((data) => writeFile(outFile, data))
      .then(() => {
        log('Read %o-block starting from %o in %o.', blockSize, recordSize, collection);
        recordSize += blockSize;
      });

  });
  const one = new Promise<Map<number, ArqRecord>>((resolve, reject) => {
    parser.on('end', () => {
      resolve(dataset);
    });

  });
  inStream.pipe(parser);
  return one;
};

export const Arq2Hrvst = (inFile: string, outFile: string): any => {
  const consolidatedOut = path.join(outFile, 'out.xml');
  const header = writeFile(
    consolidatedOut,
    '<mws:harvest xmlns:mws="http://search.mathweb.org/ns" data-set="mse" data-doc-id="consolidated" data-collection="00">\n',
    { encoding: 'utf8' },
  );
  let count = 0;
  // @ts-ignore
  return header.then(() => afs.readdirAsync(inFile))
    .map((file: string) => {
      count++;
      log('schedule file %o total %d', file, count);
      return processFile(path.join(inFile, file as string), consolidatedOut);
    }, { concurrency: 20 })
    .then(() => (writeFile(consolidatedOut, '</mws:harvest>\n')))
    .then(() => count);
};