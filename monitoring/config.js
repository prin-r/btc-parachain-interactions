const config = () => {
  const config = {
    DATABASE_URL: process.env.DATABASE_URL,
    BAND_SCHEMA: process.env.BAND_SCHEMA,
    TARGET_SCHEMA: process.env.TARGET_SCHEMA,
    TARGET_NETWORK: process.env.TARGET_NETWORK,
    PRIVATE_KEY: process.env.PRIVATE_KEY || "//Bob",
    INTERLAY_URL: process.env.INTERLAY_URL || "ws://127.0.0.1:9944",
    BALANCE_THRESHOLD: parseInt(process.env.BALANCE_THRESHOLD || "5000000000"),
    API_TOKEN: process.env.API_TOKEN,

    ROUTING_KEY: process.env.ROUTING_KEY,
  }
  if (!config.DATABASE_URL) {
    throw new Error("Missing DB url")
  }
  if (!config.TARGET_SCHEMA) {
    throw new Error("Missing target schema")
  }
  if (!config.TARGET_NETWORK) {
    throw new Error("Missing target network")
  }
  if (!config.PRIVATE_KEY) {
    throw new Error("Missing private key")
  }
  if (!config.INTERLAY_URL) {
    throw new Error("Missing interlay url")
  }
  if (!config.BALANCE_THRESHOLD) {
    throw new Error("Missing balance threshold")
  }
  if (!config.API_TOKEN) {
    throw new Error("Missing api token")
  }
  return config
}

module.exports = config()
