"use strict";

const config = require('./config');
const logger = require('./src/logger');

const Twitter = require('./src/twitter.js');
const twitter = new Twitter(config.twitter);

const https = require('https');
const cron = require('node-cron');
const { createCanvas } = require('canvas');
// const fs = require('fs');

(async function () {

  logger.log('init')

  // onSchedule()
  cron.schedule('0 */8 * * *', () => onSchedule());
})()

async function onSchedule() {
  logger.log('start')

  var uaInfo = await getUAInfo()
  // var uaInfo = JSON.parse(fs.readFileSync('uainfo.json'))
  var piedata = loadData(uaInfo)
  
  logger.log(JSON.stringify(piedata))

  var total = Object.values(piedata).reduce((a, c) => a + c)
  var percentage = piedata['Taproot'] / total * 100;

  var text = `Bitcoin Node Taproot Support: ${percentage.toFixed(2)}%\n`;
  text += '\n\nNode count:'
  
  for (var [name, count] of Object.entries(piedata)) {
    text += `\n${name}: ${count}`;
  }

  var buffer = createImage(piedata, total)

  var mediaUpload = await twitter.postMediaUpload(buffer)
  // fs.writeFileSync('image.png', buffer)

  await twitter.postStatus(text, mediaUpload.media_id_string);

  logger.log('finished')
}

function createImage(piedata, total) {
  const canvas = createCanvas(1200, 600);
  const ctx = canvas.getContext('2d');

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.imageSmoothingEnabled = false;

  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.fill();

  var gradient_orange = ctx.createRadialGradient(cx, cy, 225, cx, cy, 300);
  gradient_orange.addColorStop(0, '#fa9f1e');
  gradient_orange.addColorStop(1, '#ee7a21');

  var gradient_blue = ctx.createRadialGradient(cx, cy, 225, cx, cy, 300);
  gradient_blue.addColorStop(0, '#40a2f3');
  gradient_blue.addColorStop(1, '#1c77d0');

  var gradient_grey = ctx.createRadialGradient(cx, cy, 225, cx, cy, 300);
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

  var labels = []
  
  for(var [name, count] of Object.entries(piedata)) {
    beginAngle = endAngle;
    var angle = (count / total) * 2 * Math.PI;
    endAngle = endAngle + angle;
    
    ctx.beginPath();
    ctx.fillStyle = piedataclr[name];
    
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, cy - 10, beginAngle, endAngle);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.fill();

    labels.push({
      text: `${count} ${name} (${(count / total * 100).toFixed(2)}%)`,
      angle: beginAngle + angle / 2
    })
  }

  for (var i = 1; i < labels.length; i++) {
    if ((labels[i].angle - labels[i - 1].angle) < 0.05) {
      labels[i - 1].angle -= 0.025
      labels[i].angle += 0.025
    }
  }

  ctx.font = `12px DejaVu Sans Mono`;
  ctx.fillStyle = 'black'
  ctx.textBaseline = 'middle'
  for (var [name, label] of Object.entries(labels)) {
    const x = Math.cos(label.angle) * 300
    const y = Math.sin(label.angle) * 300

    ctx.textAlign = x > 0 ? 'left' : 'right'
    ctx.fillText(label.text, cx + x, cy + y)
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
  
    logger.log(`${count.toString().padStart(8, ' ')} ${useragent} ${key}`)
    result[key] += count
  }
  
  return result
}

function getKey(useragent) {
  const parts = useragent.split('/').filter(Boolean)
  const main = parse(parts[0])
  switch(main.product) {
    case 'Satoshi':
      if ((main.major >= 22) || (main.major == 21 && main.minor >= 1))
        return 'Taproot'
      return 'Non-enforcing'
    case 'btcwire':
      if (parts[1]) {
        const sub = parse(parts[1])
        if (sub.product == 'btcd') {
          // btcd doesn't have a taproot version yet
          // if (sub.major >= 22)
          //   return 'Taproot'
          return 'Non-enforcing'
        }
      }
      break;
    case 'Gocoin':
      return 'Taproot'
    case 'bcoin':
      return 'Non-enforcing'
    case 'BitcoinUnlimited':
    case 'therealbitcoin.org':
    case 'bitcoin-seeder':
      return 'Light'
  }
  return 'Unknown'
}

function parse(useragent) {
  const split = useragent.split(':')
  const version = split[1].split('.')
  if (version[0] == 0) version.shift()
  return {product: split[0], major: version[0], minor: version[1]}
}
