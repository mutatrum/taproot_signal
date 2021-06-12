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

var finished = false;

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

    const taproot = blockchainInfo.softforks.taproot;
    const softfork = taproot[taproot.type];
    const statistics = softfork.statistics;
    var since = softfork.since;
    while (since + statistics.period < blockchainInfo.blocks) {
      since += statistics.period
    }

    sock.connect(addr)

    sock.subscribe('hashblock')

    sock.on('message', async function (topic, message) {
      if (topic.toString() === 'hashblock') {
        const blockHash = message.toString('hex')
        var result = await processBlockHash(blockHash)
        logger.log(`Block ${result.height} ${result.pool}: ${result.taproot ? '✅' : '🛑'}`)

        if (finished) return;
  
        if (result.taproot) {
          if (!knownPools.includes(result.pool)) {
            knownPools.push(result.pool)

            var text = `🚨 NEW POOL 🚨\n\nTaproot signal by ${result.pool} in block ${result.height}`

            await twitter.postStatus(text)
          }
        }

        var count = 0
        for (var i = 0; i < 2016; i++) {
          var block = blocks[since + i]
          if (block && block.taproot) {
            count++
          }
        }

        logger.log(`Number of taproot blocks: ${count}`);

        if (!result.taproot) {
          if (count >= 1790) {
            await twitter.postStatus(`Block ${result.height}: 🟦.\n\nYou're drunk, ${result.pool}. Go home.`)
          }
          return;
        }
        
        switch (count) {
          case 1615: {
            logger.log(`Everything set to go, 200 blocks left.`)
            break;
          }
          case 1715: {
            await twitter.postStatus('We are 💯 taproot signalling blocks away from reaching the threshold of 1815 blocks for taproot lock-in.')
            break;
          }
          case 1765: {
            await twitter.postStatus('Only 5️⃣0️⃣ more signalling blocks to reach lock-in threshold for taproot')
            break;
          }
          case 1790: {
            await twitter.postStatus('2️⃣5️⃣ blocks to go. At 10 minutes a block that is roughly 4 hours.')
            break;
          }
          case 1800: {
            await twitter.postStatus('1️⃣5️⃣ block left. Objects in rear view mirror are closer than they appear. 🦕 🦖')
            break;
          }
          case 1805: {
            await twitter.postStatus('We are at T-🔟 blocks before lock-in. 🚀')
            break;
          }
          case 1806: {
            await twitter.postStatus('9️⃣ blocks to go.\n\nStay humble. Stack sats.\n-- @ODELL')
            break;
          }
          case 1807: {
            await twitter.postStatus('Only 8️⃣ blocks to go.\n\nThe Times 03/Jan/2009 Chancellor on brink of second bailout for banks')
            break;
          }
          case 1808: {
            await twitter.postStatus('7️⃣ more blocks.\n\nDiario El Salvador 09/Jun/2021 ASAMBLEA APRUEBA A LEY BITCOIN') 
            break;
          }
          case 1809: {
            await twitter.postStatus('6️⃣ blocks left.\n\nCraig Wright is a fraud.\nWe are all @hodlonaut.')
            break;
          }
          case 1810: {
            await twitter.postStatus('Only 5️⃣ blocks to go.\n\n#Bitcoin is freedom money.')
            break;
          }
          case 1811: {
            await twitter.postStatus('4️⃣ more blocks.\n\n“I want you to understand what it means to lose your freedom.”\n-- Ross Ulbricht\n\n#FreeRoss.')
            break;
          }
          case 1812: {
            await twitter.postStatus('3️⃣ blocks to go.\n\n#Bitcoin is a weapon of mass construction.')
            break;
          }
          case 1813: {
            await twitter.postStatus(`2️⃣ to go.\n\nLET'S GO!`)
            break;
          }
          case 1814: {
            await twitter.postStatus(`1️⃣`)
            break;
          }
          case 1815: {

            const buffer = image.createImage(since, blocks, 'SIGFORK');

            var text = `🚨 TAPROOT LOCKED IN 🚨\n\nWith block ${result.height} signalling for taproot, there are 1815 signalling blocks in the currency difficulty period.\n\nTaproot will activate in block 709632, somewhere in November 2021.\n\nSo long, and thanks for all the fish.\n\nSee you all at @anyprevout.`
            await twitter.postStatus(text, buffer)

            finished = true
            
            break;
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
    if (finished) return;

    const blockchainInfo = await bitcoin_rpc.getBlockchainInfo();
  
    const taproot = blockchainInfo.softforks.taproot;
    const softfork = taproot[taproot.type];
    const statistics = softfork.statistics;

    var since = softfork.since;
    while (since + statistics.period < blockchainInfo.blocks) {
      since += statistics.period
    }

    const start_time = new Date(softfork.start_time * 1000).toISOString().split('T')[0];
    const timeout = new Date(softfork.timeout * 1000).toISOString().split('T')[0];
    const percentage = (statistics.count / statistics.elapsed * 100).toFixed(2) + '%';
    const progress = (statistics.elapsed / statistics.period * 100).toFixed(2) + '%';
    const buffer = image.createImage(since, blocks, percentage);
  
    var text = `Taproot signal: ${statistics.count}/${statistics.elapsed} blocks (${percentage})\n`;
    text += `Difficulty period: ${statistics.elapsed}/${statistics.period} blocks (${progress})\n`;
    text += `Estimated signal: ${Math.round(statistics.count/statistics.elapsed*statistics.period)} blocks\n`
    if (statistics.possible) {
      text += `Activation threshold: ${statistics.threshold} blocks`
    } else {
      text += 'Activation is not possible this period'
    }
  
    // const fs = require('fs');
    // fs.writeFileSync('image.png', buffer);
  
    // countPools(blockchainInfo, statistics)
  
    await twitter.postStatus(text, buffer);
  }
  
  function hasTaproot(version) {
    return (version & 0xE0000004) == 0x20000004;
  }
}
