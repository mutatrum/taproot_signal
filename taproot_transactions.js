"use strict";

const config = require('./config');
const logger = require('./src/logger');
const crypto = require("crypto");

const BitcoinRpc = require('./src/bitcoin-rpc.js');
const bitcoin_rpc =  new BitcoinRpc(config.bitcoind);

const Twitter = require('./src/twitter.js');
const twitter = new Twitter(config.twitter);

const cron = require('node-cron');

const { createCanvas } = require('canvas');
const fs = require('fs');

(async function () {
  var test = process.argv.splice(2).indexOf('test') != -1

  logger.log('init')

  const networkInfo = await bitcoin_rpc.getNetworkInfo()
  logger.log(`connected to Bitcoin Core ${networkInfo.subversion} on ${config.bitcoind.host}:${config.bitcoind.zmqport}`)

  if (test) {
    onSchedule(test)
  } else {
    cron.schedule('0 0 * * *', () => onSchedule(false));
  }
})()

const types = ['coinbase', 'fee', 'pubkey', 'pubkeyhash', 'scripthash', 'multisig', 'witness_v0_keyhash', 'witness_v0_scripthash', 'witness_v1_taproot', 'witness_unknown', 'nulldata', 'nonstandard']

async function onSchedule(test) {

  let inscription = /^20[a-f0-9]{64}ac0063036f72640101/

  try {
    logger.log('start')

    var time = Math.floor(new Date().getTime() / 1000) - ((test ? 1 : 24) * 60 * 60)

    var blockHash = await bitcoin_rpc.getBestBlockHash()
    var block = await bitcoin_rpc.getBlock(blockHash, 3)

    var ins = {}
    var outs = {'coinbase': {count: 0, value: 0}, 'fee': {count:0, value: 0}}
    let ordinals = {}
    let blockStats = {}
    let totalWeight = 0

    var lastBlock = block.height;

    while(time < block.time) {

      let currentBlockOrdinal = {}
      blockStats[block.height] = {total: block.weight, inscriptions: currentBlockOrdinal}

      var fee = 0

      var txids = new Set()

      if (test) {
        logger.log(`Height ${block.height}`)
      }

      for (var tx of block.tx.splice(1)) {

        txids.add(tx.txid)

        fee += tx.fee

        for (var vout of tx.vout) {
          var type = vout.scriptPubKey.type

          if (types.indexOf(type) === -1) types.push(type)

          if (typeof outs[type] === 'undefined') {
            outs[type] = {count : 0, value : 0}
          }
          outs[type].count += 1
          outs[type].value += vout.value
        }

        let inscriptionCount = 0
        let content_type = null

        for (var vin of tx.vin) {
          var prevout = vin.prevout
          var type = prevout.scriptPubKey.type

          if (types.indexOf(type) === -1) types.push(type)

          if (typeof ins[type] === 'undefined') {
            ins[type] = {count : 0, value : 0}
          }

          ins[type].count += 1
          if (txids.has(vin.txid)) {
            // Transaction is spent in same block
            outs[type].value -= prevout.value
          } else {
            ins[type].value += prevout.value
          }

          if (prevout.scriptPubKey.type === 'witness_v1_taproot') {
            for (var txinwitness of vin.txinwitness) {
              if(txinwitness.match(inscription)) {
                inscriptionCount++
                let length = parseInt(txinwitness.substring(84, 86), 16)
                content_type = Buffer.from(txinwitness.substring(86, 86 + (length * 2)), "hex").toString("utf-8").split(';')[0].split('+')[0].split('/')[1]
              }
            }
          }
        }

        if (inscriptionCount === 1) {
          let ordinal = ordinals[content_type]
          if (!ordinal) {
            ordinal = {count: 0, size: 0}
            ordinals[content_type] = ordinal
          }
          ordinal.count++
          ordinal.size += (tx.hex.length / 2)

          let currentOrdinal = currentBlockOrdinal[content_type]
          if (!currentOrdinal) {
            currentOrdinal = {count: 0, size: 0}
            currentBlockOrdinal[content_type] = currentOrdinal
          }
          currentOrdinal.count++
          currentOrdinal.size += (tx.hex.length / 2)
        }
      }

      outs['coinbase'].value += block.tx[0].vout[0].value - fee
      outs['fee'].value += fee

      totalWeight += block.weight

      // if (test) {
      //   console.log(JSON.stringify({height: block.height, weight: block.weight, inscriptions: Object.fromEntries(ordinals)}))
      // }

      var firstBlock = block.height;

      blockHash = block.previousblockhash
      block = await bitcoin_rpc.getBlock(blockHash, 3)
    }

    Object.values(ins).forEach(entry => entry.value = Number(entry.value.toFixed(8)))
    Object.values(outs).forEach(entry => entry.value = Number(entry.value.toFixed(8)))

    logger.log(JSON.stringify({time: time, firstBlock: firstBlock, lastBlock: lastBlock, in: ins, out: outs}))

    var date = formatDate(new Date(block.mediantime * 1000))
    var caption = `Block ${firstBlock} to ${lastBlock}`

    var value = Object.values(ins).reduce((acc, entry) => acc + entry['value'], 0);
    var valueHeader = `Total: ${valueFormatter(value)}`
    var buffer1 = createImage(ins, outs, 'value', valueHeader, caption, date, valueFormatter)

    const taproot_in = ins['witness_v1_taproot'];
    const taproot_out = outs['witness_v1_taproot'];
    var text1 =
    `Value transacted in the last 24h (block ${firstBlock} to ${lastBlock}):

Taproot: ${valueFormatter(taproot_in.value)} in (${formatPercentage(taproot_in.value_percentage)}), ${valueFormatter(taproot_out.value)} out (${formatPercentage(taproot_out.value_percentage)})
Total: ${valueFormatter(value)}`

    if (!test) {
      var media1 = await twitter.postMediaUpload(buffer1)
      var tweet1 = await twitter.postStatus(text1, media1.media_id_string)
    } else {
      logger.log(`Tweet: \n${text1}`)
      fs.writeFileSync('image1.png', buffer1)
    }

    var in_count = Object.values(ins).reduce((acc, entry) => acc + entry['count'], 0);
    var out_count = Object.values(outs).reduce((acc, entry) => acc + entry['count'], 0);
    var countHeader = `UTXOs: ${in_count} in, ${out_count} out`
    var buffer2 = createImage(ins, outs, 'count', countHeader, caption, date)

    var text2 =
    `UTXOs in the last 24h (block ${firstBlock} to ${lastBlock}):

Taproot: ${taproot_in.count} in (${formatPercentage(taproot_in.count_percentage)}), ${taproot_out.count} out (${formatPercentage(taproot_out.count_percentage)})
Total: ${in_count} in, ${out_count} out`

    if (!test) {
      var media2 = await twitter.postMediaUpload(buffer2);
      var tweet2 = await twitter.postStatus(text2, media2.media_id_string, tweet1.id_str)
    } else {
      logger.log(`Tweet: \n${text2}`)
      fs.writeFileSync('image2.png', buffer2)
    }

    let totalSize = 0
    let totalCount = 0

    Object.values(ordinals).forEach(ordinal => {totalSize += ordinal.size; totalCount += ordinal.count})
    
    let sortedOrdinals = Object.entries(ordinals).sort(([,a],[,b]) => b.size-a.size)

    var text3 = `Ordinals:

Total: ${totalCount}, ${formatSize(totalSize)} (${formatPercentage(totalSize * 100 / totalWeight)})
`
    let max_length = 280 - config.twitter.screen_name.length - 2
    for (var [content_type, ordinal] of sortedOrdinals) {
      let line = `
${content_type.toUpperCase()}: ${ordinal.count}, ${formatSize(ordinal.size)} (${formatPercentage(ordinal.size * 100 / totalWeight)})`
      if (line.length + text3.length > max_length) break
      text3 += line
    }

    var inscriptionsHeader = `Inscriptions: ${totalCount}, ${formatSize(totalSize)} (${formatPercentage(totalSize * 100 / totalWeight)})`

    var buffer3 = createInscriptionImage(blockStats, inscriptionsHeader, caption, date)

    if (!test) {
      var media3 = await twitter.postMediaUpload(buffer3);
      var tweet3 = await twitter.postStatus(text3, media3.media_id_string, tweet2.id_str)
    } else {
      logger.log(`Tweet: ${text3}`)
      fs.writeFileSync('image3.png', buffer3)
    }

    logger.log('finished')

  }
  catch (e) {
    console.log(e)
  }
}

function createImage(ins, outs, key, header, caption, date, formatter) {
  if (typeof formatter === 'undefined') formatter = value => value
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
  gradient.addColorStop(0.00, '#40a2f3')
  gradient.addColorStop(0.20, '#1c77d0')
  gradient.addColorStop(0.50, 'black')
  gradient.addColorStop(0.80, '#ee7a21')
  gradient.addColorStop(1.00, '#fa9f1e')

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
        ctx.fillText(`${formatter(value)}  ${formatPercentage(percentage)}`, x1 - 9, y1 + 9)

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
        ctx.fillText(`${formatPercentage(percentage)}  ${formatter(value)}`, x2 + 9, y2 + 9)

        y1 += percentage
        y2 += percentage + gap
      }
    }
  }

  return canvas.toBuffer();
}

function createInscriptionImage(blockStats, header, caption, date, formatter) {
  try {
    if (typeof formatter === 'undefined') formatter = value => value
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
  
    ctx.font = `18px DejaVu Sans Mono`
    ctx.textAlign = 'center'
    ctx.fillText(header, cx, 30)
  
    ctx.font = `12px DejaVu Sans Mono`
    ctx.fillText(date, cx, 50)
    ctx.fillText(caption, cx, 580)
  
    let blockStep = 1100 / Object.keys(blockStats).length
    let blockWidth = blockStep / 2
  
    let x = 50 + blockWidth

    let totalHeight = 450

    let heightRatio = Math.round(4_000_000 / totalHeight) // 4MB max block size, 500 pixels

    let content_types = []
  
    for (let [block, stats] of Object.entries(blockStats)) {

      let y = 70 + totalHeight

      let total = Math.round(stats.total / heightRatio)

      ctx.beginPath()
      ctx.rect(Math.floor(x - blockWidth), y - totalHeight, Math.ceil(blockStep), totalHeight)
      ctx.fillStyle = 'grey'
      ctx.fill()

      ctx.beginPath()
      ctx.rect(Math.floor(x - blockWidth), y - total, Math.ceil(blockStep), total)
      ctx.fillStyle = 'blue'
      ctx.fill()
      
      for (let [content_type, ordinals] of Object.entries(stats.inscriptions)) {

        if (!content_types.includes(content_type)) content_types.push(content_type)

        let height = Math.round(ordinals.size / heightRatio)
        y -= height

        ctx.beginPath()
        ctx.rect(Math.floor(x - blockWidth), y, Math.ceil(blockStep), height)
        ctx.fillStyle = `#${createHash(content_type, 3)}`
        ctx.fill()

        // ctx.fillStyle = 'white'
        // ctx.fillText(content_type, x, y + (height / 2))
      }
  
      if (block % 10 == 0) {        
        ctx.font = `12px DejaVu Sans Mono`
        ctx.fillStyle = 'black'
        ctx.fillText(block, x, totalHeight + 85)
      }
  
      x += blockStep
    }

    ctx.textAlign = 'left'

    x = 60
    for (var content_type of content_types) {
      ctx.beginPath()
      ctx.rect(x, totalHeight + 100, 10, 10)
      ctx.fillStyle = `#${createHash(content_type, 3)}`
      ctx.fill()

      ctx.fillStyle = 'black'
      ctx.fillText(content_type, x + 15, totalHeight + 105)

      x += ctx.measureText(content_type).width + 30
    }
  
    return canvas.toBuffer();
  }
  catch (e) {
    console.log(e)
  }
}

function createHash(data, len) {
  return crypto.createHash("shake256", { outputLength: len }).update(data).digest("hex");
}

function valueFormatter(value) {
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

function formatPercentage(percentage) {
  const zeros = Math.floor(-Math.log10(percentage))
  const digits = Math.max(1, zeros + 1)
  return `${percentage.toFixed(digits)}%`
}

function formatSize(size) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size > 1024) return `${(size / 1024).toFixed(1)} kB`
  return `${size} b`
}

function pad(string) {
  return string.toString().padStart(2, '0');
}
