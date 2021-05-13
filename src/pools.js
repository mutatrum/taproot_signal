const fs = require('fs')
const logger = require('./logger')

module.exports = function() {

  // https://raw.githubusercontent.com/btccom/Blockchain-Known-Pools/master/pools.json
  const pools = JSON.parse(fs.readFileSync('pools.json'))

  this.getPool = function(transaction) {
    for (var vout of transaction.vout) {
      if (vout.value > 0) {
        const address = vout.scriptPubKey.addresses
        if (address) {
          const pool = pools.payout_addresses[address]
          if (pool) {
            return pool.name
          }
        }
      }
    }
    
    const coinbase = Buffer.from(transaction.vin[0].coinbase, 'hex').toString();
    for (var [tag, pool] of Object.entries(pools.coinbase_tags)) {
      if (coinbase.indexOf(tag) != -1) {
        return pool.name
      }
    }
  
    return 'unknown'
  }
}
