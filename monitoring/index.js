const { Sequelize, Model, DataTypes } = require("sequelize")
const { createPolkabtcAPI } = require("@interlay/polkabtc")
const { Keyring } = require("@polkadot/api")
const { CronJob } = require("cron")
const config = require("./config")
const { alert, catchIncident } = require("./notification")
const isMainnet = false
const sequelize = new Sequelize(config.DATABASE_URL, { logging: false })

class RelayerBalance extends Model {}
RelayerBalance.init(
  {
    timestamp: { type: DataTypes.DATE, primaryKey: true },
    address: { type: DataTypes.STRING, primaryKey: true },
    balance: { type: DataTypes.DECIMAL, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_relayer_balance`,
  }
)

class RealWorldPrice extends Model {}
RealWorldPrice.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    category: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    value: { type: DataTypes.DECIMAL, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    tableName: "real_world_price",
  }
)

class SymbolDetail extends Model {}
SymbolDetail.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    interval: { type: DataTypes.INTEGER, allowNull: false },
    max_changed: { type: DataTypes.FLOAT, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_symbol_detail`,
  }
)

class ContractPriceDetail extends Model {}
ContractPriceDetail.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    contract_value: { type: DataTypes.DECIMAL, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    requestId: { type: DataTypes.INTEGER, allowNull: false },
    txHash: { type: DataTypes.STRING, allowNull: false },
    status: {
      type: DataTypes.ENUM("Ok", "WrongPrice", "Delay"),
      allowNull: false,
    },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_contract_price_detail`,
  }
)

class LatestResult extends Model {}
LatestResult.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    resolved_time: { type: DataTypes.INTEGER, allowNull: false },
    requestId: { type: DataTypes.INTEGER, allowNull: false },
    txHash: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_latest_result`,
  }
)

const getAddress = () => {
  const keyring = new Keyring({ type: "sr25519" })
  return keyring.addFromUri(config.PRIVATE_KEY).address
}

const getBalance = async (account) => {
  try {
    const polkaBTC = await createPolkabtcAPI(config.INTERLAY_URL, isMainnet)
    return (await polkaBTC.collateral.balanceDOT(account)).toBigInt()
  } catch {
    return 0
  }
}

const updateBalance = async () => {
  let balance = await getBalance(getAddress())
  if (balance < config.BALANCE_THRESHOLD) {
    await alert(
      "Relayer account less that threshold",
      `Balance of ${config.RELAYER} on ${config.TARGET_NETWORK} is ${balance}, please send some tokens before system downed`
    )
  }
  await RelayerBalance.create({
    timestamp: new Date(),
    address: config.RELAYER,
    balance: balance.toString(),
  })
}

const getReferenceDataBulk = async (symbols) => {
  const polkaBTC = await createPolkabtcAPI(config.INTERLAY_URL, isMainnet)

  const btc_dot = await polkaBTC.oracle.getExchangeRate()
  const {
    fast,
    half,
    hour,
  } = await polkaBTC.oracle.api.query.exchangeRateOracle.satoshiPerBytes()

  const rates = {
    BTC_DOT: btc_dot.toString(),
    BTC_F: fast.toString(),
    BTC_HH: half.toString(),
    BTC_H: hour.toString(),
  }

  const latestTimestamp = await polkaBTC.oracle.getLastExchangeRateTime()

  return symbols.map((symbol) => ({
    rate: rates[symbol],
    last_updated_base: latestTimestamp.toString(),
    last_updated_quote: latestTimestamp.toString(),
  }))
}

const updateContractStatus = async () => {
  const details = await SymbolDetail.findAll()
  const symbols = details.map(({ dataValues }) => dataValues.symbol)
  const contractValues = await getReferenceDataBulk(symbols)

  for (const [idx, detail] of details.entries()) {
    const realPrice = await RealWorldPrice.findByPk(detail.symbol)
    const latestResult = await LatestResult.findByPk(detail.symbol)
    const duration =
      (new Date().getTime() -
        new Date(contractValues[idx].last_updated_base).getTime()) /
      1000
    const deviation = contractValues[idx].rate / realPrice.value
    const timestamp = new Date(contractValues[idx].last_updated_base)
    const basicDetail = {
      symbol: symbols[idx],
      contract_value: contractValues[idx].rate,
      timestamp: timestamp,
      requestId: latestResult.requestId,
      txHash: latestResult.txHash,
    }
    if (duration > 10 * detail.interval) {
      await ContractPriceDetail.upsert(
        Object.assign(basicDetail, { status: "Delay" })
      )
      await alert(
        "The price value from the contract is too old.",
        `Last update of ${detail.symbol} in contract is ${timestamp}`
      )
    } else if (deviation < 0.9 || deviation > 1.1) {
      await ContractPriceDetail.upsert(
        Object.assign(basicDetail, { status: "WrongPrice" })
      )
      await alert(
        "Data derivation from real data source too much",
        `Value of ${detail.symbol} in contract is ${contractValues[idx].rate} but in the real world is ${realPrice.value}`
      )
    } else {
      await ContractPriceDetail.upsert(
        Object.assign(basicDetail, { status: "Ok" })
      )
    }
  }
}

;(async () => {
  await updateBalance()
  await updateContractStatus()
  new CronJob("0 */10 * * * *", catchIncident(updateBalance), null, true)
  new CronJob("0 */10 * * * *", catchIncident(updateContractStatus), null, true)
})()
