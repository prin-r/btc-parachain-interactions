const config = () => {
  const config = {
    DATABASE_URL: process.env.DATABASE_URL,
    BAND_SCHEMA: process.env.BAND_SCHEMA,
    TARGET_SCHEMA: process.env.TARGET_SCHEMA,
    TARGET_NETWORK: process.env.TARGET_NETWORK,
    PRIVATE_KEY: process.env.PRIVATE_KEY || "//Bob",
    INTERLAY_URL: process.env.INTERLAY_URL || "ws://127.0.0.1:9944",
    TX_WAIT_PERIOD: parseInt(process.env.TX_WAIT_PERIOD),
    WS_TIMEOUT_QUERY: process.env.WS_TIMEOUT_QUERY,
    WS_TIMEOUT_TX: process.env.WS_TIMEOUT_TX,
    API_TOKEN: process.env.API_TOKEN,
    ROUTING_KEY: process.env.ROUTING_KEY,
  }
  if (!config.DATABASE_URL) {
    throw new Error("Missing DB url")
  }
  if (!config.BAND_SCHEMA) {
    throw new Error("Missing band chain schema")
  }
  if (!config.TARGET_SCHEMA) {
    throw new Error("Missing target schema")
  }
  if (!config.TARGET_NETWORK) {
    throw new Error("Missing target network")
  }
  if (!config.WS_TIMEOUT_QUERY) {
    throw new Error("Missing ws timeout for query")
  }
  if (!config.WS_TIMEOUT_TX) {
    throw new Error("Missing ws timeout for tx")
  }
  if (!config.PRIVATE_KEY) {
    throw new Error("Missing private key")
  }
  if (!config.TX_WAIT_PERIOD) {
    throw new Error("Missing tx wait period")
  }
  if (!config.API_TOKEN) {
    throw new Error("Missing api token")
  }
  return config
}

module.exports = config()
