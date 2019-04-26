import parse = require('csv-parse');
import path = require( 'path');

const mathml: any = require('mathml');
import stringify = require('csv-stringify');
import fs = require('fs');
import yaml = require('js-yaml');
import xmlDom = require('xmldom');
import xpath = require('xpath');
import { Record } from './record';

let converted = 0;

const minimize = (mml: any) =>
  mathml(mml)
    .toMinimalPmml(['id', 'xref', 'alttext', 'display', 'class', 'kmcs-r', 'stretchy']).toString();

export function extract(mml: string, docID: number, outFile: string, collection: string = path.basename(outFile)) {
  const parser = new xmlDom.DOMParser();
  const parsed = parser.parseFromString(mml);
  const select = xpath.useNamespaces({ 'm': 'http://www.w3.org/1998/Math/MathML' });
  const nodes = select('//m:math', parsed);
  if (nodes.length) {
    let output = `<mws:harvest xmlns:mws="http://search.mathweb.org/ns" data-set="zbl" data-doc-id="${docID}" data-collection="${collection}">`;
    let i = 0;
    nodes.forEach(n => output += `<mws:expr url="${docID}#${++i}">\n${minimize(n)}\n</mws:expr>`);
    output += '</mws:harvest>';
    console.log(`Converted ${++converted}`);
    fs.writeFile(`${outFile}/${docID}.xml`, output, err => {
    });
  }
}

function getMws(record: Record, docID: number, outFile: string) {
  if (!record || !record.mml) {
    console.log(`Skipping ${docID}`);
    return;
  }
  extract(record.mml, docID, outFile);

}

export const Harvest = (ymlIds: string, inFile: string, outFile: string) => {
  const inStream = fs.createReadStream(inFile);
  const stringifier = stringify({ header: true });
  const parser = parse({ columns: true, cast: true });
  const doc = yaml.safeLoad(fs.readFileSync(ymlIds, 'utf8'));
  const dataset: Map<number, Record> = new Map();


  let recordSize = 0;
  parser.on('readable', () => {
    let record;
    while (record = parser.read()) {
      dataset.set(record.id, record);
      console.log('Read records ' + ++recordSize);
    }
  });
  const one = new Promise<Map<number, Record>>((resolve, reject) => {
    parser.on('end', () => {
      resolve(dataset);
    });

  });
  inStream.pipe(parser);
  one.then((dataset: Map<number, Record>) => {
    Object.keys(doc).map(key => {
      const result = (doc[key] || []).forEach((docID: number) => {
        const record = <Record>dataset.get(docID);
        let path = `${outFile}${key}`;
        if (!fs.existsSync(path)) {
          fs.mkdirSync(path);
        }
        return getMws(record, docID, path);
      });
      console.log(result);
    });
  });

  return one;

};




