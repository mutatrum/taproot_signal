"use strict";

const config = require('./config');
const logger = require('./src/logger');

const Twitter = require('./src/twitter.js');
const twitter = new Twitter(config.twitter);

const https = require('https');
const cron = require('node-cron');
const { createCanvas } = require('canvas');

(async function () {

  logger.log('init')

  cron.schedule('0 */8 * * *', () => onSchedule());
})()

async function onSchedule() {
  logger.log('start')

  var uaInfo = await getUAInfo()
  var piedata = loadData(uaInfo)
  
  logger.log(JSON.stringify(piedata))

  var total = Object.values(piedata).reduce((a, c) => a + c)
  var percentage = piedata['Taproot'] / total * 100;

  var text = `Bitcoin Node Taproot Support: ${percentage.toFixed(2)}%\n`;
  for (var i = 1; i <= percentage; i++) {
    text += '🟧'
    if (i % 10 == 0) {
      text += '\n'
    }
  }
  text += '\n\nNode count:'
  
  for (var [name, count] of Object.entries(piedata)) {
    text += `\n${name}: ${count}`;
  }

  var buffer = createImage(piedata, total)

  await twitter.postStatus(text, buffer);

  logger.log('finished')
}

function createImage(piedata, total) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext('2d');

  const x = canvas.width / 2;
  const y = canvas.height / 2;

  ctx.imageSmoothingEnabled = false;

  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.fill();

  var gradient_orange = ctx.createRadialGradient(x, y, 175, x, y, 225);
  gradient_orange.addColorStop(0, '#fa9f1e');
  gradient_orange.addColorStop(1, '#ee7a21');

  var gradient_blue = ctx.createRadialGradient(x, y, 175, x, y, 225);
  gradient_blue.addColorStop(0, '#40a2f3');
  gradient_blue.addColorStop(1, '#1c77d0');

  var gradient_grey = ctx.createRadialGradient(x, y, 175, x, y, 225);
  gradient_grey.addColorStop(0, '#909090');
  gradient_grey.addColorStop(1, '#686868');

  var piedataclr = {
    'Taproot': gradient_orange,
    'Non-enforcing': gradient_blue,
    'Light': gradient_grey,
    'Unknown': gradient_grey
  };
  
  var beginAngle = 0;
  var endAngle = 0;
  
  for(var [name, count] of Object.entries(piedata)) {
    beginAngle = endAngle;
    var angle = (count / total) * 2 * Math.PI;
    endAngle = endAngle + angle;
    
    ctx.beginPath();
    ctx.fillStyle = piedataclr[name];
    
    ctx.moveTo(x, y);
    ctx.arc(x, y, y - 10, beginAngle, endAngle);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fill();

    if (count / total < 0.04) {
      ctx.font = `6px DejaVu Sans Mono`;
    } else {
      ctx.font = `9px DejaVu Sans Mono`;
    }

    ctx.fillStyle = 'black'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${count} ${name} (${(count / total * 100).toFixed(2)}%)`, x + (Math.cos(beginAngle + angle / 2) * 225), y + (Math.sin(beginAngle + angle / 2) * 225))
  }

  return canvas.toBuffer();
}

function getUAInfo() {
  return new Promise(function(resolve, reject) {
    https.get('https://luke.dashjr.org/programs/bitcoin/files/charts/data/uainfo.json', {headers: {'accept': 'application/json'}}, res => {
      let body = "";
      res.on("data", data => {
        body += data;
      });
      res.on("end", () => {
        resolve(JSON.parse(body));
      });
    });
  });
}

function loadData(uainfo) {
  var result = {'Taproot': 0, 'Non-enforcing': 0, 'Light': 0, 'Unknown': 0}

  for (const [useragent, info] of Object.entries(uainfo)) {
  
    if (info.listening == 0) continue; // Skip non-listening nodes
  
    const count = info.listening + info.est_unreachable
    const key = getKey(useragent)
  
    console.log(`${count.toString().padStart(8, ' ')} ${useragent} ${key}`)
    result[key] += count
  }
  
  return result
}

function getKey(useragent) {
  const useragents = useragent.split('/').filter(Boolean)
  const rootagent = useragents[0].split(':')
  const rootbrand = rootagent[0]
  switch(rootbrand) {
    case 'Satoshi':
      const rootversion = rootagent[1].split('.')
      if (rootversion[0] == 0)
        rootversion.shift()
      const major = rootversion[0]
      const minor = rootversion[1]
      if (major >= 22)
        return 'Taproot'
      if (major == 21 && minor >= 1)
        return 'Taproot'
      return 'Non-enforcing'
    case 'btcwire':
      const subagent = useragents[1].split(':')
      const subbrand = subagent[0]
      if (subbrand == 'btcd') {
        const subversion = subagent[1].split('.')
        if (subversion[0] == 0)
          subversion.shift()
        const submajor = subversion[0]
        if (submajor >= 22)
          return 'Taproot'
        return 'Non-enforcing'
      }
      break;
    case 'Gocoin':
      return 'Taproot'
    case 'BitcoinUnlimited':
    case 'therealbitcoin.org':
      return 'Light'
  }
  return 'Unknown'
}
