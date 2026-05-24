const crypto = require("node:crypto");

function createId() {
  return crypto.randomUUID();
}

module.exports = {
  createId
};
