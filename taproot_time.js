"use strict";

const config = require('./config');
const logger = require('./src/logger');

const BitcoinRpc = require('./src/bitcoin-rpc.js');
const bitcoin_rpc =  new BitcoinRpc(config.bitcoind);

const Twitter = require('./src/twitter.js');
const twitter = new Twitter(config.twitter);

const zmq = require('zeromq');

const TAPROOT_HEIGHT = 709632;
const DIFFICULTY_PERIOD = 2016;

(async function () {

  logger.log('init')

  const sock = zmq.socket('sub')
  sock.connect(`tcp://${config.bitcoind.host}:${config.bitcoind.zmqport}`)  
  sock.subscribe('hashblock')
  sock.on('message', onMessage);
  
  const networkInfo = await bitcoin_rpc.getNetworkInfo()
  logger.log(`connected to Bitcoin Core ${networkInfo.subversion} on ${config.bitcoind.host}:${config.bitcoind.zmqport}`)
})()

async function onMessage(topic, message) {
  if (topic.toString() === 'hashblock') {
    const currentBlockHash = message.toString('hex')
    const currentBlock = await bitcoin_rpc.getBlock(currentBlockHash)

    var currentHeight = currentBlock.height
    var currentBlockTime = currentBlock.mediantime
    var currentDifficulty = currentHeight / DIFFICULTY_PERIOD;
    if (currentHeight == TAPROOT_HEIGHT) {
      
      var activationTime = formatDate(new Date((currentBlockTime) * 1000))
      var text = `🚨 TAPROOT ACTIVATED 🚨\n\nTaproot has been activated in block ${currentHeight}, at difficulty period ${currentDifficulty}, on ${activationTime}.\n\nThis is not a goodbye, my darling, this is a thank you.\n\nSee you all at @anyprevout.`;
      
      await twitter.postStatus(text)
      
      return
    }
    if (currentHeight > TAPROOT_HEIGHT) {
      return
    }
    var heightDelta = TAPROOT_HEIGHT - currentHeight
    var previousHeight = currentHeight - heightDelta
    var previousBlockHash = await bitcoin_rpc.getBlockHash(previousHeight)
    var previousBlock = await bitcoin_rpc.getBlock(previousBlockHash)
    var previousBlockTime = previousBlock.mediantime
    var timeDelta = currentBlockTime - previousBlockTime
    var taprootTime = formatDate(new Date((currentBlockTime + timeDelta) * 1000))

    logger.log(`block ${currentHeight}, taproot activation estimated on ${taprootTime}`)
    
    if (Number.isInteger(currentDifficulty)) {
      var taprootDifficulty = TAPROOT_HEIGHT / DIFFICULTY_PERIOD;
      var difficultyDelta = heightDelta / DIFFICULTY_PERIOD;
      var blocks = '🟧'.repeat(difficultyDelta);

      var text = `Taproot activation\n${blocks}\n\nCurrent block: ${currentHeight}, difficulty period: ${currentDifficulty}\nActivation block: ${TAPROOT_HEIGHT}, difficulty period: ${taprootDifficulty}\nBlocks to go: ${heightDelta}, difficulty periods to go: ${difficultyDelta}\nEstimated activation: ${taprootTime}`;

      await twitter.postStatus(text)
    }
  }
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(string) {
  return string.toString().padStart(2, '0');
}
