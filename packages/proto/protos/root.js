const { patchProtobufRoot } = require('../lib/patch-protobuf-root');
const unpatchedRoot = require('./static-module');
module.exports = patchProtobufRoot(unpatchedRoot);
