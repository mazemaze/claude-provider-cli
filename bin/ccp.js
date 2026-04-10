#!/usr/bin/env node

process.env.CCP_SHORT_ALIAS = "1";

const { main } = require("./claude-provider.js");

main();
