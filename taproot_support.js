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

  var uaInfo = await getUAInfo();
  var piedata = loadData(uaInfo)
  
  logger.log(JSON.stringify(piedata))

  var total = 0;
  for (var [name, count] of Object.entries(piedata)) {
    total += count;
  }
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

// Source from https://luke.dashjr.org/programs/bitcoin/files/charts/taproot.html
function loadData(uainfo) {
  var piedatagrp = [
    'taproot',
    'none',
    'non-full',
    'unknown',
  ];
  var grplabel = {
    none: 'Non-enforcing',
    "non-full": 'Light',
    taproot: 'Taproot',
    unknown: 'Unknown',
  };
  var piedata = {};

  var i, tot = 0, ua;
  function flag(t, n) {
    piedata[t] += n;
    tot += n;
  }
  
  function autoflag_a(n, v, current_versions, type) {
    if (vercmp(v, current_versions) > 0) {
      flag(type, n);
    } else {
      flag('none', n);
    }
  }
  
  function vercmp(a, b) {
    var cs, bs, isHigher;
    bs = b;
    for (var i = 0; i < 4; ++i) {
      if (a[i] < bs[0][i]) {
        return -1;
      }
      if (a[i] == bs[0][i] && i == 3) {
        return 0;
      }
      cs = [];
      isHigher = false;
      for (var j = 0; j < bs.length; ++j) {
        if (bs[j][i] == a[i]) {
          cs.push(bs[j]);
        }
        else
        if (bs[j][i] > a[i]) {
          isHigher = true;
        }
      }
      if (cs.length == 0)
        return isHigher ? -1 : 1;
      bs = cs;
    }
    return NaN;
  }
  
  // Lowercase list of non-full node UAs
  var nonfull_uas = [
    // Pseudo-SPV
    'bitcoinj',
    'bitcoin wallet for android',
    'bither',
    'bitsquare',
    'breadwallet',
    'multibit',
    'multibit hd',
    
    // Fails to implement all rules
    'therealbitcoin.org',
    
    // Contentious "hardforks"
    'bitcoin unlimited',
    'bitcoin xt',
    'bitcoin classic',
  ];
  
  var coreversioning_uas = [
    'bitcoin xt',
    'satoshi rbf',
    'bitcoin core',
  ];
  
  for (var i = 0; i < piedatagrp.length; ++i) {
    piedata[piedatagrp[i]] = 0;
  }
  
  var info, n, cn, pv, v, j, uac;
  
  var all_uas = []
  var incl_unreachable = true;//!getQueryVariable('onlylistening', false);
  var skip_no_listeners = true;//getQueryVariable('skip_no_listeners', false);
  if (null == skip_no_listeners) {
    skip_no_listeners = true;
  } else {
    skip_no_listeners = JSON.parse(skip_no_listeners);
  }
  for (ua in uainfo) {
    if (!uainfo.hasOwnProperty(ua)) {
      continue;
    }
    var this_ua_info = uainfo[ua];
    
    if (this_ua_info['listening'] == 0 && skip_no_listeners) {
      continue;
    }
    
    this_ua_info['n'] = this_ua_info['listening'];
    if (incl_unreachable) {
      this_ua_info['n'] += this_ua_info['est_unreachable'];
    }
    
    all_uas.push(ua);
  }
  
  all_uas.sort(function(a, b){
    return uainfo[b]['n'] - uainfo[a]['n'];
  });
  
  var simple_uas = [
    'bcoin',
    'bitcoin xt',
    'bitcore',
    'bither',
    'bitsquare',
    'breadwallet',
    'gocoin',
    'libbitcoin',
    'multibit',
    'therealbitcoin.org',
    'satoshi rbf',
  ];
  var mappable_uas = {
    'bitcoin-qt': 'Bitcoin Core',
    'satoshi': 'Bitcoin Core',
    'bitcoinunlimited': 'Bitcoin Unlimited',
    'btcd': 'btcsuite',
    'btcwire': 'btcsuite',
    'knots': 'Bitcoin Knots',
    'next': 'Bitcoin Knots',
    'next-test': 'Bitcoin Knots',
    'ljr': 'Bitcoin Knots',
    'eligius': 'Bitcoin Knots',
    'multibithd': 'MultiBit HD',
  };
  
  function ver_postprocess(v) {
    while (v.length < 4) {
      v.push(0);
    }
    for (j = 1; j < v.length; ++j) {
      v[j] = parseInt(v[j], 10);
      if (v[j] > 90) {
        ++v[j-1];
        v[j] -= 100;
      }
    }
  }
  
  ualoop:
  for (i = 0; i < all_uas.length; ++i) {
    var ua = all_uas[i];
    var n = uainfo[ua]['n'];
    
    var ua_split = ua.split(/\//);
    
    var cn = '';
    var v = [-1,-1,-1,-1];
    
    var is_bitcoinj = false;
    var corever = null;
    for (j = 0; j < ua_split.length; ++j) {
      var uacc = ua_split[j].split(':');
      var uac = uacc[0];
      var uac_lc = uac.toLowerCase();
      if (uac_lc == 'withtaproot') {
        flag('taproot', n);
        continue ualoop;
      } else
      if (simple_uas.indexOf(uac_lc) > -1) {
        cn = uac;
      } else
      if (uac_lc == 'bitcoinj') {
        is_bitcoinj = true;
      } else
      if (is_bitcoinj && uac == 'Bitcoin Wallet') {
        cn = 'Bitcoin Wallet for Android';
      } else
      if (uac.match(/^Bither1\.[\d.]+$/)) {
        cn = 'Bither';
      } else
      if (uac_lc in mappable_uas) {
        cn = mappable_uas[uac_lc];
      } else
      if (uac == 'Classic' && !is_bitcoinj) {
        cn = 'Bitcoin Classic';
      } else {
        continue;
      }
      var orig_cn = uac;
      if (uacc.length > 1) {
        v = uacc[1].split(/\./);
      } else {
        v = [];
      }
      if (coreversioning_uas.indexOf(cn.toLowerCase()) > -1) {
        corever = v.slice();  // copy
      }
    }
    ver_postprocess(v);
    if (corever) {
      ver_postprocess(corever);
    }
    
    if (cn == '') {
      flag('unknown', n);
      continue;
    }
    
    if (orig_cn == 'bcoin') {
      autoflag_a(n, v, [[2,1,2,0]], 'unknown');
      continue;
    }
    if (orig_cn == 'btcd') {
      autoflag_a(n, v, [[0,21,0,0]], 'unknown');
      continue;
    }
    if (orig_cn == 'btcwire') {
      autoflag_a(n, v, [[0,2,0,0]], 'unknown');
      continue;
    }
    if (orig_cn == 'Gocoin') {
      autoflag_a(n, v, [[1,9,8,0]], 'unknown');
      continue;
    }
    if (cn == 'libbitcoin') {
      autoflag_a(n, v, [[3,6,0,0]], 'unknown');
      continue;
    }
    
    if (cn == 'Bitcoin XT' && vercmp(v, [[0,11,-10,0]]) < 0) {
      // For consensus purposes, this was the same as Core
      cn = 'Bitcoin Core';
    }
    if (nonfull_uas.indexOf(cn.toLowerCase()) > -1) {
      flag('non-full', n);
      continue;
    }
    
    if (corever) {
      v = corever;
  
      // Latest version this graph has been updated to
      if (vercmp(v, [[22,0,0,0]]) > 0) {
        flag('unknown', n);
        continue;
      }

      if (cn == 'Bitcoin Core' && vercmp(v, [[0,21,1,0]]) == 0) {  // ST
        flag('taproot', n);
        continue;
      }
      if (cn == 'Bitcoin Core' && vercmp(v, [[22,0,0,0]]) == 0) {  // ST
        flag('taproot', n);
        continue;
      }

      if (vercmp(v, [[0,21,1,0]]) < 0) {
        flag('none', n);
        continue;
      }
    }
    
    flag('unknown', n);
  }  
  var result = {}
  for (var [group, count] of Object.entries(piedata)) {
    result[grplabel[group]] = count
  }
  return result;
}
