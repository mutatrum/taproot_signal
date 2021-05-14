const cron = require('node-cron');
const fs = require('fs');

const logger = require('./logger');

const BitcoinRpc = require('./bitcoin-rpc.js');
let bitcoin_rpc;

const Image = require('./image.js');
const image = new Image();

const Twitter = require('./twitter.js');
let twitter;

const Pools = require('./pools.js');
let pools = new Pools();

const zmq = require('zeromq');
module.exports = function (config) {
  bitcoin_rpc = new BitcoinRpc(config.bitcoind)
  twitter = new Twitter(config.twitter)

  const START_HEIGHT = 681408;

  var blocks = {}
  const knownPools = []

  this.run = async function () {
    logger.log('Taproot Signal')

    const networkInfo = await bitcoin_rpc.getNetworkInfo()

    logger.log(`Connected to Bitcoin Core ${networkInfo.subversion} on ${config.bitcoind.host}`)

    const blockchainInfo = await bitcoin_rpc.getBlockchainInfo()

    logger.log(JSON.stringify(blockchainInfo));

    logger.log(`Current block: ${blockchainInfo.blocks}`)

    var start = START_HEIGHT
    try {
      blocks = JSON.parse(fs.readFileSync('blocks.json'))
      start = Math.max.apply(null,Object.keys(blocks))
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.log(`File not found, scanning from ${start}`);
      } else {
        throw err;
      }
    }    

    var total = blockchainInfo.blocks - start;

    if (total > 0) {
      logger.log(`Fetching ${total} blocks`)
  
      var i = 0;
      for (var height = start; height <= blockchainInfo.blocks; height++) {
        const blockHash = await bitcoin_rpc.getBlockHash(height)
  
        const result = await processBlockHash(blockHash);
  
        i++;
        if (i % 100 == 0) {
          logger.log(`Fetching ${Math.round(i / total * 100)}%`)
        }
      }
    }

    for (var [height, block] of Object.entries(blocks)) {
      if (block.taproot) {
        if (!knownPools.includes(block.pool)) {
          knownPools.push(block.pool)
        }
      }
    }
    logger.log(`Known pools: ${knownPools}`)

    var sock = zmq.socket('sub')
    var addr = `tcp://${config.bitcoind.host}:${config.bitcoind.zmqport}`

    sock.connect(addr)

    sock.subscribe('hashblock')

    sock.on('message', async function (topic, message) {
      if (topic.toString() === 'hashblock') {
        const blockHash = message.toString('hex')
        var result = await processBlockHash(blockHash)
        logger.log(`Block ${result.height} ${result.pool}: ${result.taproot ? '✅' : '🛑'}`)

        if (result.taproot) {
          if (!knownPools.includes(result.pool)) {
            knownPools.push(result.pool)

            var text = `🚨 NEW POOL 🚨\n\nTaproot signal by ${result.pool} in block ${result.height}`

            logger.log(`Tweet: ${text}`)
            await twitter.postStatus(text)
          }
        }

        fs.writeFileSync('blocks.json', JSON.stringify(blocks));
      }
    });

    // twitter.openStream(onTweet);

    // onSchedule();
    cron.schedule('0 */4 * * *', () => onSchedule());
  }

  async function processBlockHash(blockHash) {
    const block = await bitcoin_rpc.getBlock(blockHash)
    const taproot = hasTaproot(block.version);
    const transaction = await bitcoin_rpc.getRawTransaction(block.tx[0], true, blockHash)
    const pool = pools.getPool(transaction)
    const result = {
      height: block.height,
      pool: pool,
      taproot: taproot
    }
    blocks[block.height] = result;
    return result;
  }
  
  async function onSchedule() {
    const blockchainInfo = await bitcoin_rpc.getBlockchainInfo();
  
    const taproot = blockchainInfo.softforks.taproot;
    const softfork = taproot[taproot.type];
    const statistics = softfork.statistics;

    logger.log(JSON.stringify(blockchainInfo))

    var since = softfork.since;
    while (since + statistics.period < blockchainInfo.blocks) {
      since += statistics.period
    }

    // var elapsed = (blockchainInfo.blocks % 2016) + 1;
    // var since = blockchainInfo.blocks - elapsed;
    // if (elapsed == 0) {
    //   since -= 2016;
    //   elapsed = 2016;
    // }
    // var count = 0;
    // for (var i = 0; i <= elapsed; i++) {
    //   var result = blocks[since + i];
    //   if (result.taproot) {
    //     count++
    //   }
    // }
  
    const start_time = new Date(softfork.start_time * 1000).toISOString().split('T')[0];
    const timeout = new Date(softfork.timeout * 1000).toISOString().split('T')[0];
    const percentage = (statistics.count / statistics.elapsed * 100).toFixed(2) + '%';
    const buffer = image.createImage(since, blocks, percentage);
  
    var text = `Taproot signal blocks: ${statistics.count}/${statistics.elapsed} (${percentage})\n`;
    text += `Blocks remaining: ${statistics.period - statistics.elapsed}\n`;
    if (statistics.possible) {
      text += `Activation threshold: ${statistics.threshold} blocks.`
    } else {
      text += 'Activation is not possible this period.'
    }
  
    logger.log('Tweet: ' + text)
  
    // const fs = require('fs');
    // fs.writeFileSync('image.png', buffer);
  
    // countPools(softfork.since, statistics)
  
    await twitter.postStatus(text, buffer);
  }
  
  function hasTaproot(version) {
    return (version & 0xE0000004) == 0x20000004;
  }
  
  function countPools(since, statistics) {
    var result = {}
    for (var i = 0; i < statistics.elapsed; i++) {
      var height = since + i;
      var block = blocks[height];
      if (block.taproot) {
        if (!result[block.pool]) {
          result[block.pool] = {
            firstSignal: height,
            since: height,
            fullSignal: 1,
            count: 1,
            blocks: '✅' 
          }
        } else {
          if (result[block.pool].fullSignal == 0) {
            result[block.pool].since = height;
          }
          result[block.pool].fullSignal++;
          result[block.pool].count++;
          result[block.pool].blocks += '✅'
        }
      } else {
        if (result[block.pool]) {
          result[block.pool].lastNonSignal = height
          result[block.pool].fullSignal = 0;
          result[block.pool].blocks += '🛑'
        }
      }
    }
    for (var [pool, statistics] of Object.entries(result)) {
      logger.log(`${pool}: ${statistics.blocks}`)
      // if (statistics.lastNonSignal) {
      //     if (statistics.fullSignal == 0) {
      //       logger.log(`${pool}: first signal: ${statistics.since}: ${statistics.count} blocks`)
      //     } else {
      //       logger.log(`${pool}: first signal: ${statistics.firstSignal}, ${statistics.fullSignal} blocks since ${statistics.since}`)
      //     }
      // } else {
      //   logger.log(`${pool}: since ${statistics.firstSignal}: ${statistics.fullSignal} blocks`)
      // }
    }
    logger.log(JSON.stringify(result))
  }  
}
