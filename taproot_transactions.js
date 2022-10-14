"use strict";

const config = require('./config');
const logger = require('./src/logger');

const BitcoinRpc = require('./src/bitcoin-rpc.js');
const bitcoin_rpc =  new BitcoinRpc(config.bitcoind);

const Twitter = require('./src/twitter.js');
const twitter = new Twitter(config.twitter);

const cron = require('node-cron');

const { createCanvas } = require('canvas');
const fs = require('fs');

(async function () {

  logger.log('init')

  const networkInfo = await bitcoin_rpc.getNetworkInfo()
  logger.log(`connected to Bitcoin Core ${networkInfo.subversion} on ${config.bitcoind.host}:${config.bitcoind.zmqport}`)

  // onSchedule()
  cron.schedule('0 0 * * *', () => onSchedule());
})()

const types = ['coinbase', 'fee', 'pubkey', 'pubkeyhash', 'scripthash', 'multisig', 'witness_v0_keyhash', 'witness_v0_scripthash', 'witness_v1_taproot', 'witness_unknown', 'nulldata', 'nonstandard']

async function onSchedule() {
  var time = Math.floor(new Date().getTime() / 1000) - (24 * 60 * 60) // 8 hours
  
  var blockHash = await bitcoin_rpc.getBestBlockHash()
  var block = await bitcoin_rpc.getBlock(blockHash, 3)

  var ins = {}
  var outs = {'coinbase': {count: 0, amount:0}, 'fee': {count:0, amount: 0}}
  var fee = 0
  
  var lastBlock = block.height;
  
  while(time < block.time) {

    var txids = new Set()

    logger.log(`Height ${block.height}`)

    for (var tx of block.tx.splice(1)) {

      txids.add(tx.txid)

      fee += tx.fee 

      for (var vout of tx.vout) {
        var type = vout.scriptPubKey.type
        if (typeof outs[type] === 'undefined') {
          outs[type] = {count : 0, amount : 0}
        }
        outs[type].count += 1
        outs[type].amount += vout.value
      }

      for (var vin of tx.vin) {
        var prevout = vin.prevout
        var type = prevout.scriptPubKey.type

        if (typeof ins[type] === 'undefined') {
          ins[type] = {count : 0, amount : 0}
        }

        ins[type].count += 1
        if (txids.has(vin.txid)) {
          // Transaction is spent in same block
          outs[type].amount -= prevout.value
        } else {
          ins[type].amount += prevout.value
        }
      }
    }

    var coinbase = block.tx[0]
    outs['coinbase'].amount += coinbase.vout[0].value - fee
    outs['fee'].amount += fee

    var firstBlock = block.height;

    blockHash = block.previousblockhash
    block = await bitcoin_rpc.getBlock(blockHash, 3)
  }

  var date = formatDate(new Date(block.mediantime * 1000))
  var caption = `Block ${firstBlock} to ${lastBlock}`
  
  var amount = Object.values(ins).reduce((acc, entry) => acc + entry['amount'], 0);
  var amountHeader = `Total: ${formatAmount(amount)}`
  var buffer1 = createImage(ins, outs, 'amount', amountHeader, caption, date, formatAmount)
  
  const taproot_in = ins['witness_v1_taproot'];
  const taproot_out = outs['witness_v1_taproot'];
  var text1 = 
  `Taproot value from block ${firstBlock} to ${lastBlock}:

${formatAmount(taproot_in.amount)} (${taproot_in.amount_percentage.toFixed(1)}%)

Total: ${formatAmount(amount)}`

  logger.log(text1)

  var media1 = await twitter.postMediaUpload(twitter, buffer1)
  var tweet1 = await twitter.postStatus(text1, media1.media_id_string)

  logger.log(`Tweet ${tweet1.id}`)

  var in_count = Object.values(ins).reduce((acc, entry) => acc + entry['count'], 0);
  var out_count = Object.values(outs).reduce((acc, entry) => acc + entry['count'], 0); 
  var countHeader = `UTXOs: ${formatCount(in_count)} in, ${formatCount(out_count)} out`
  var buffer2 = createImage(ins, outs, 'count', countHeader, caption, date, formatCount)

  var text2 = 
  `Taproot UTXOs from block ${firstBlock} to ${lastBlock}:
  
${taproot_in.count} in (${taproot_in.count_percentage.toFixed(1)}%), ${taproot_out.count} out (${taproot_out.count_percentage.toFixed(1)}%)

Total: ${formatCount(in_count)} in, ${formatCount(out_count)} out`

  logger.log(text2)

  var media2 = await twitter.postMediaUpload(twitter, buffer2);
  var tweet2 = await twitter.postStatus(text2, media2.media_id_string, tweet1.id)

  logger.log(`Tweet ${tweet2.id}`)

  // fs.writeFileSync('image.png', buffer1)
  // fs.writeFileSync('image2.png', buffer2)
}

function createImage(ins, outs, key, header, caption, date, formatValue) {
  const canvas = createCanvas(1200, 600)
  const ctx = canvas.getContext('2d')

  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const width = 350
  const height = 200
  const gapsize = 300

  ctx.imageSmoothingEnabled = false

  ctx.beginPath()
  ctx.rect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'white'
  ctx.fill()

  ctx.fillStyle = 'black'
  ctx.textBaseline = 'middle'

  const gradient = ctx.createLinearGradient(cx - width, 0, cx + width, 0);
  gradient.addColorStop(0, '#1c77d0');
  gradient.addColorStop(0.5, 'black');
  gradient.addColorStop(1, '#ee7a21');

  var intotal = Object.values(ins).reduce((acc, entry) => acc + entry[key], 0);
  var outtotal = Object.values(outs).reduce((acc, entry) => acc + entry[key], 0);

  ctx.font = `18px DejaVu Sans Mono`
  ctx.textAlign = 'center'
  ctx.fillText(header, cx, 30)
  
  ctx.font = `12px DejaVu Sans Mono`
  ctx.fillText(date, cx, 50)
  ctx.fillText(caption, cx, 580)

  var x1 = cx - width
  var x2 = cx

  var y1 = cy - (height / 2) - (gapsize / 2)
  var y2 = cy - (height / 2)

  var gap1 = gapsize / (Object.values(ins).filter(entry => entry[key] > 0).length - 1)
  var gap2 = 0

  for (var type of types) {
    if (ins.hasOwnProperty(type)) {

      var value = ins[type][key]

      if (value > 0) {

        var percentage = value / intotal * 100

        ins[type][`${key}_percentage`] = percentage
      
        y1 += percentage
        y2 += percentage
    
        ctx.lineWidth = (percentage * height / 100) + 0.25
        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.bezierCurveTo(x1 + (width / 2), y1, x2 - (width / 2), y2, x2, y2)
        ctx.stroke()

        ctx.fillStyle = 'white'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x1, y1 - percentage)
        ctx.lineTo(x1 + percentage, y1)
        ctx.lineTo(x1, y1 + percentage)
        ctx.fill()
        ctx.fillStyle = 'black'
    
        ctx.textAlign = 'right'
        ctx.fillText(type, x1 - 9, y1 - 9)
        ctx.fillText(`${formatValue(value)}  ${percentage.toFixed(1)}%`, x1 - 9, y1 + 9)
    
        y1 += percentage + gap1
        y2 += percentage + gap2
      }
    }
  }

  var x1 = cx
  var x2 = cx + width

  var y1 = cy - (height / 2)
  var y2 = cy - (height / 2) - (gapsize / 2)

  var gap = gapsize / (Object.values(outs).filter(entry => entry[key] > 0).length - 1)

  for (var type of types) {
    if (outs.hasOwnProperty(type)) {

      var value = outs[type][key]

      if (value > 0) {

        var percentage = value / outtotal * 100

        outs[type][`${key}_percentage`] = percentage
 
        y1 += percentage
        y2 += percentage
  
        ctx.lineWidth = Math.max(percentage * 2, 0.25)
        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.bezierCurveTo(x1 + (width / 2), y1, x2 - (width / 2), y2, x2, y2)
        ctx.stroke()
  
        ctx.fillStyle = 'white'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x2,                   y2 - percentage - 10)
        ctx.lineTo(x2 - percentage - 10, y2 - percentage - 10)
        ctx.lineTo(x2,                   y2)
        ctx.lineTo(x2 - percentage - 10, y2 + percentage + 10)
        ctx.lineTo(x2,                   y2 + percentage + 10)
        ctx.fill()
        ctx.fillStyle = 'black'

        ctx.textAlign = 'left'
        ctx.fillText(type, x2 + 9, y2 - 9)
        ctx.fillText(`${percentage.toFixed(1)}%  ${formatValue(value)}`, x2 + 9, y2 + 9)
  
        y1 += percentage
        y2 += percentage + gap
      }
    }
  }

  return canvas.toBuffer();
}

function formatCount(value) {
  return value
}

function formatAmount(value) {
  if (value < 0.000001) return `${(value * 1e8).toFixed(0)} sats`
  if (value < 0.001) return `${(value * 1e5).toFixed(1)}k sats`
  if (value < 1) return `${(value * 1e2).toFixed(1)}k sats`
  if (value < 10) return `${value.toFixed(2)} ₿`
  if (value < 1000) return `${value.toFixed(1)} ₿`
  return `${(value / 1000).toFixed(1)}k ₿`
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(string) {
  return string.toString().padStart(2, '0');
}