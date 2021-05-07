"use strict";

const config = require('./config');
const Main = require('./src/main.js');

new Main(config).run();
