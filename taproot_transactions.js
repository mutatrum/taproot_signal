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

const TYPES = ['coinbase', 'fee', 'pubkey', 'pubkeyhash', 'scripthash', 'multisig', 'witness_v0_keyhash', 'witness_v0_scripthash', 
               'witness_v1_taproot', 'witness_unknown', 'nulldata', 'nonstandard']

const MPN65 = [/*'#ff0029',*/ '#377eb8', '#66a61e', '#984ea3', '#00d2d5', '#ff7f00', '#af8d00', '#7f80cd', '#b3e900', '#c42e60', 
               '#a65628', '#f781bf', '#8dd3c7', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#fccde5', '#bc80bd', '#ffed6f', 
               '#c4eaff', '#cf8c00', '#1b9e77', '#d95f02', '#e7298a', '#e6ab02', '#a6761d', '#0097ff', '#00d067', '#000000', 
               '#252525', '#525252', '#737373', '#969696', '#bdbdbd', '#f43600', '#4ba93b', '#5779bb', '#927acc', '#97ee3f', 
               '#bf3947', '#9f5b00', '#f48758', '#8caed6', '#f2b94f', '#eff26e', '#e43872', '#d9b100', '#9d7a00', '#698cff', 
               '#d9d9d9', '#00d27e', '#d06800', '#009f82', '#c49200', '#cbe8ff', '#fecddf', '#c27eb6', '#8cd2ce', '#c4b8d9', 
               '#f883b0', '#a49100', '#f48800', '#27d0df', '#a04a9b']

let INSCRIPTION_PATTERN = /^20[a-f0-9]{64}ac0063036f72640101[a-f0-9]*68$/

async function onSchedule(test) {

  try {


    // for (var y = 1; y < 102; y++) {
    //   let l = ''
    //   for (var x = 1; x < 102; x++) {
    //     l += getKind(x, y) + ';'
    //   }
    //   console.log(l)
    // }

    logger.log('start')

    var time = Math.floor(new Date().getTime() / 1000) - ((test ? 24 : 24) * 60 * 60)

    var blockHash = await bitcoin_rpc.getBestBlockHash()
    var block = await bitcoin_rpc.getBlock(blockHash, 3)

    var ins = {}
    var outs = {'coinbase': {count: 0, value: 0}, 'fee': {count:0, value: 0}}
    let blockStats = {}
    let kinds = {}
    let inscriptions = {}
    let totalWeight = 0

    var lastBlock = block.height;

    let oneins = new Set()
    let oneouts = new Set()
    let oneone = []

    while(time < block.time) {

      let currentBlockInscriptions = {}
      let currentBlockKinds = {}
      blockStats[block.height] = {total: block.weight, inscriptions: currentBlockInscriptions, kinds: currentBlockKinds}

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

          if (TYPES.indexOf(type) === -1) TYPES.push(type)

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

          if (TYPES.indexOf(type) === -1) TYPES.push(type)

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
              if(txinwitness.match(INSCRIPTION_PATTERN)) {
                inscriptionCount++
                let length = parseInt(txinwitness.substring(84, 86), 16)
                content_type = Buffer.from(txinwitness.substring(86, 86 + (length * 2)), "hex").toString("utf-8").split(';')[0].split('+')[0].split('/')[1]
              }
            }
          }
        }

        if (inscriptionCount === 1) {
          let totalInscriptions = inscriptions[content_type]
          if (!totalInscriptions) {
            totalInscriptions = {count: 0, size: 0}
            inscriptions[content_type] = totalInscriptions
          }
          totalInscriptions.count++
          totalInscriptions.size += tx.weight

          let currentInscriptions = currentBlockInscriptions[content_type]
          if (!currentInscriptions) {
            currentInscriptions = {count: 0, size: 0}
            currentBlockInscriptions[content_type] = currentInscriptions
          }
          currentInscriptions.count++
          currentInscriptions.size += tx.weight
        }
        // if (tx.vin.length === 1 && tx.vout.length === 1) {
        //   let inaddr = tx.vin[0].prevout.scriptPubKey.address
        //   let outaddr = tx.vout[0].scriptPubKey.address
        //   oneins.add(inaddr)
        //   oneouts.add(outaddr)
        //   oneone.push([inaddr, outaddr])
        // }

        let kind = inscriptionCount === 0 ? getKind(tx.vin.length, tx.vout.length) : 'Inscript.'

        let totalKind = kinds[kind]
        if (!totalKind) {
          totalKind = {count: 0, size: 0}
          kinds[kind] = totalKind
        }
        totalKind.count++
        totalKind.size += tx.weight

        let currentKind = currentBlockKinds[kind]
        if (!currentKind) {
          currentKind = {count: 0, size: 0}
          currentBlockKinds[kind] = currentKind
        }
        currentKind.count++
        currentKind.size += tx.weight
      }

      outs['coinbase'].value += block.tx[0].vout[0].value - fee
      outs['fee'].value += fee

      totalWeight += block.weight

      // if (test) {
      //   console.log(JSON.stringify({height: block.height, weight: block.weight, inscriptions: Object.fromEntries(inscriptions)}))
      // }

      var firstBlock = block.height;

      blockHash = block.previousblockhash
      block = await bitcoin_rpc.getBlock(blockHash, 3)
    }

    oneone.forEach((entry) => {
      let i = entry[0]
      let o = entry[1]
      if (oneins.has(o) || oneouts.has(i)) {
        console.log(`${i} -> ${o}`)
      }
    })
    
    // for (let [in, out] of ) {

    // }

    console.log(`Blocks: ${Object.keys(blockStats).length}`)

    // let sortedKinds = Object.entries(kinds).sort(([,a],[,b]) => b.size-a.size)

    // let rest = {size: 0, count: 0}

    // for (let [kind, stats] of sortedKinds) {
    //   let percentage = stats.size / totalWeight * 100
    //   if (percentage > 0.5) {
    //     console.log(`${kind} ${stats.count} ${formatSize(stats.size)} (${formatPercentage(percentage)}) ${formatSize(Math.round(stats.size / stats.count))}/tx`)
    //   } else {
    //     rest.size += stats.size
    //     rest.count++
    //   }
    // }
    // let restPercentage = rest.size / totalWeight * 100
    // console.log(`others ${rest.count} ${formatSize(rest.size)} (${formatPercentage(restPercentage)}) ${formatSize(Math.round(rest.size / rest.count))}/tx`)

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


    let max_length = 280 - config.twitter.screen_name.length - 2

    // Kinds

    let totalSize = 0
    let totalCount = 0

    Object.values(kinds).forEach(kind => {totalSize += kind.size; totalCount += kind.count})
    
    let sortedKinds = Object.entries(kinds).sort(([,a],[,b]) => b.size-a.size)

    var text3 = `Kinds:

Total: ${totalCount}, ${formatSize(totalSize)}
`
    for (var [kind, stats] of sortedKinds) {
      let line = `
${kind}: ${stats.count}, ${formatSize(stats.size)} (${formatPercentage(stats.size * 100 / totalWeight)})`
      if (line.length + text3.length > max_length) break
      text3 += line
    }

    var kindsHeader = `Kinds: ${totalCount}, ${formatSize(totalSize)}`

    var buffer3 = createInscriptionImage(blockStats, kindsHeader, caption, date, sortedKinds.map(e => e[0]), 'kinds', kinds)

    if (!test) {
      var media3 = await twitter.postMediaUpload(buffer3);
      var tweet3 = await twitter.postStatus(text3, media3.media_id_string, tweet2.id_str)
    } else {
      logger.log(`Tweet: ${text3}`)
      fs.writeFileSync('image3.png', buffer3)
    }


    // Inscriptions

    let totalIncriptionSize = 0
    let totalInscriptionCount = 0

    Object.values(inscriptions).forEach(inscription => {totalIncriptionSize += inscription.size, totalInscriptionCount += inscription.count})
    
    let sortedInscriptions = Object.entries(inscriptions).sort(([,a],[,b]) => b.size-a.size)

    var text4 = `Inscriptions:

Total: ${totalInscriptionCount}, ${formatSize(totalIncriptionSize)} (${formatPercentage(totalIncriptionSize * 100 / totalWeight)})
`
    for (var [content_type, stats] of sortedInscriptions) {
      let line = `
${content_type}: ${stats.count}, ${formatSize(stats.size)} (${formatPercentage(stats.size * 100 / totalWeight)})`
      if (line.length + text4.length > max_length) break
      text4 += line
    }

    var inscriptionsHeader = `Inscriptions: ${totalInscriptionCount}, ${formatSize(totalIncriptionSize)} (${formatPercentage(totalIncriptionSize * 100 / totalWeight)})`

    var buffer4 = createInscriptionImage(blockStats, inscriptionsHeader, caption, date, sortedInscriptions.map(e => e[0]), 'inscriptions', inscriptions)

    if (!test) {
      var media4 = await twitter.postMediaUpload(buffer4);
      var tweet4 = await twitter.postStatus(text4, media4.media_id_string, tweet3.id_str)
    } else {
      logger.log(`Tweet: ${text4}`)
      fs.writeFileSync('image4.png', buffer4)
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

  for (var type of TYPES) {
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

  for (var type of TYPES) {
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

function createInscriptionImage(blockStats, header, caption, date, keys, tag, totalStats) {
  try {
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

    let blockStep = 1050 / Object.keys(blockStats).length
    let blockWidth = blockStep / 2
  
    let x = blockWidth + 10

    let totalHeight = 490

    let heightRatio = Math.round(4_000_000 / totalHeight) // 4MB max block size, 500 pixels

    for (let [block, stats] of Object.entries(blockStats)) {

      let total = Math.round(stats.total / heightRatio)
      
      let y = totalHeight + 60

      ctx.beginPath()
      ctx.rect(Math.floor(x - blockWidth), y - total, Math.ceil(blockStep), total)
      ctx.fillStyle = 'grey'
      ctx.fill()
      
      for (var i in keys) {
        let key = keys[i]

        let blockStats = stats[tag][key]
        if (blockStats) {
          let height = Math.round(blockStats.size / heightRatio)
          y -= height
    
          ctx.beginPath()
          ctx.rect(Math.floor(x - blockWidth), y, Math.ceil(blockStep), height)
          ctx.fillStyle = MPN65[i]
          ctx.fill()
        }
      }
  
      if (block % 10 == 0) {        
        ctx.font = `12px DejaVu Sans Mono`
        ctx.fillStyle = 'black'
        ctx.fillText(block, x, 560)
      }
  
      x += blockStep
    }

    let totalSize = 0
    Object.values(totalStats).forEach(kind => {totalSize += kind.size})

    let y = 65
    for (var i in keys) {
      let key = keys[i]

      ctx.beginPath()
      ctx.rect(1065, y - 5, 10, 10)
      ctx.fillStyle = MPN65[i]
      ctx.fill()

      ctx.fillStyle = 'black'
      ctx.textAlign = 'left'
      let arrowIndex = key.indexOf('→')
      let pad = ''
      if (arrowIndex !== -1) {
        while (pad.length < 5 - arrowIndex) pad += ' '
      } else {
        while (pad.length < 5 - (key.length / 2)) pad += ' '
      }
      ctx.fillText(pad + key, 1080, y)

      // ctx.textAlign = 'right'
      let percentage = formatPercentage(totalStats[key].size / totalSize * 100)
      if (percentage.indexOf('.') === 1) percentage = ' ' + percentage
      ctx.fillText(percentage, 1155, y)

      y += 20

      // if (y > 550) break
    }
  
    return canvas.toBuffer();
  }
  catch (e) {
    console.log(e)
  }
}

function getKind(i, o) {
  if (i > 1 && o === 1) return `Consolid.`
  if (i >= 10 && o === 2) return `Consolid.`
  if (i <= 2 && o <= 2) return `${i} → ${o}`
  if (i === 5 && o === 5) return `${i} → ${o}`
  if (i === 1 && o >= 10) return `Batch`
  if (i < 10 && o >= 100) return `Batch`
  return `${aggr(i)} → ${aggr(o)}`
}

function aggr(len) {
  if (len >= 100) return '100s'
  if (len >= 10) return '10s'
  if (len >= 3) return 'Few'
  return len
}

// function createHash(data, len) {
//   return crypto.createHash("shake256", { outputLength: len }).update(data).digest("hex");
// }

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
