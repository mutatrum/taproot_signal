const cron = require('node-cron');

const logger = require('./logger');

const BitcoinRpc = require('./bitcoin-rpc.js');
let bitcoin_rpc;

const Image = require('./image.js');
const image = new Image();

const Twitter = require('./twitter.js');
let twitter;

module.exports = function(config) {
    bitcoin_rpc = new BitcoinRpc(config.bitcoind);
    twitter = new Twitter(config.twitter);
    this.run = async function() {
        logger.log('Taproot Signal');

        const networkInfo = await bitcoin_rpc.getNetworkInfo();
    
        logger.log(`Connected to Bitcoin Core ${networkInfo.subversion} on ${config.bitcoind.host}`);

        // twitter.openStream(onTweet);

        cron.schedule('0 */4 * * *', () => onSchedule());        
    }
}

async function onSchedule() {
  const blockchainInfo = await bitcoin_rpc.getBlockchainInfo();

  const taproot = blockchainInfo.softforks.taproot;
  const softfork = taproot[taproot.type];
  const statistics = softfork.statistics;
  const since = softfork.since;
  const elapsed = statistics.elapsed;

  logger.log(`Scanning ${elapsed} blocks`);

  const headers = [];
  for (var block = since; block < since + elapsed; block++) {

    const blockHash = await bitcoin_rpc.getBlockHash(block)
    const blockHeader = await bitcoin_rpc.getBlockHeader(blockHash);
    blockHeader.hasTaprootSignal = (blockHeader.version & 0xE0000004) == 0x20000004;
    headers.push(blockHeader);
  }
  const start_time = new Date(softfork.start_time * 1000).toISOString().split('T')[0];
  const timeout = new Date(softfork.timeout * 1000).toISOString().split('T')[0];
  const percentage = (statistics.count / statistics.elapsed * 100).toFixed(2) + '%';
  const buffer = image.createImage(headers, percentage);

  var text = `Taproot signal blocks: ${statistics.count}/${statistics.elapsed} (${percentage})\n`;
  text += `Blocks remaining: ${statistics.period - statistics.elapsed}\n`;
  if (statistics.possible) {
    text += `Activation threshold: ${statistics.threshold} blocks.`
  } else {
    text += 'Activation is not possible this period.'
  }
  await twitter.postStatus(text, buffer);
}
