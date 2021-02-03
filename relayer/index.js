const { Sequelize, Model, DataTypes, Op } = require("sequelize")
const { CronJob } = require("cron")
const config = require("./config")
const {
  getAccount,
  sendRelayTx,
  transactionStatus,
  BTC_DOT,
  BTC_F,
  BTC_HH,
  BTC_H,
} = require("./helper")

const { alert, catchIncident } = require("./notification")

const sequelize = new Sequelize(config.DATABASE_URL, { logging: false })

class BandChainResult extends Model {}
BandChainResult.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    requestId: { type: DataTypes.INTEGER, allowNull: false },
    resolvedTime: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.BAND_SCHEMA,
    tableName: "latest_result",
  }
)

class SymbolDetail extends Model {}
SymbolDetail.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    interval: { type: DataTypes.INTEGER, allowNull: false },
    maxChanged: { type: DataTypes.FLOAT, allowNull: false },
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

class LatestResult extends Model {}
LatestResult.init(
  {
    symbol: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    requestId: { type: DataTypes.INTEGER, allowNull: false },
    txHash: { type: DataTypes.STRING, allowNull: false },
    resolvedTime: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_latest_result`,
  }
)

class RelayTx extends Model {}
RelayTx.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    txHash: { type: DataTypes.STRING, unique: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    sender: { type: DataTypes.STRING, allowNull: false },
    confirmed: { type: DataTypes.BOOLEAN, allowNull: false },
  },
  {
    sequelize,
    timestamps: false,
    underscored: true,
    schema: config.TARGET_SCHEMA,
    tableName: `${config.TARGET_NETWORK}_relay_tx`,
  }
)

// TODO: Using sign service this is not need to check on the relayer
// class EstimateValue extends Model {}
// EstimateValue.init(
//   {
//     symbol: { type: DataTypes.STRING, primaryKey: true },
//     minimum: { type: DataTypes.DECIMAL, allowNull: false },
//     maximum: { type: DataTypes.DECIMAL, allowNull: false },
//   },
//   {
//     sequelize,
//     timestamps: false,
//     underscored: false,
//     tableName: "estimate_value",
//   }
// )

async function sendTx(symbols, rates, requestIds, resolvedTimes) {
  const txHash = await sendRelayTx(symbols, rates, requestIds, resolvedTimes)
  if (txHash) {
    console.log(
      `Update ${symbols.length} symbols: ${txHash} with request id: ${requestIds[0]}`
    )
    await RelayTx.create({
      txHash,
      createdAt: new Date(),
      sender: getAccount().address,
      confirmed: false,
    })
    for (const [idx, symbol] of symbols.entries()) {
      await LatestResult.upsert({
        symbol: symbol,
        value: rates[idx],
        requestId: requestIds[idx],
        resolvedTime: resolvedTimes[idx],
        txHash: txHash,
      })
    }
    return
  }
}

const updateRate = async () => {
  let symbols = []
  let rates = []
  let requestIds = []
  let resolvedTimes = []
  const symbolDetail = await SymbolDetail.findAll()
  for (const detail of symbolDetail) {
    const bandRate = await BandChainResult.findByPk(detail.symbol)
    if (
      !bandRate ||
      ![BTC_DOT, BTC_F, BTC_HH, BTC_H].includes(bandRate.symbol)
    ) {
      continue
    }
    if (bandRate.symbol === BTC_DOT) {
      await sendTx(
        [bandRate.symbol],
        [bandRate.value],
        [bandRate.requestId],
        [bandRate.resolvedTime]
      )
    } else {
      symbols.push(bandRate.symbol)
      rates.push(bandRate.value)
      requestIds.push(bandRate.requestId)
      resolvedTimes.push(bandRate.resolvedTime)
    }
  }

  await sendTx(symbols, rates, requestIds, resolvedTimes)
}

async function checkTransaction() {
  for (const tx of await RelayTx.findAll({ where: { confirmed: false } })) {
    const status = await transactionStatus(tx.txHash, tx.createdAt)
    if (status !== null) {
      if (status >= 0) {
        tx.confirmed = true
        if (status > 0) {
          await alert(
            "Tx has been mined but return non zero code",
            `Transaction ${tx.txHash} has been processed but returned ${status} error code.`
          )
        }
        await tx.save()
      } else if (status === -1) {
        await alert(
          "Transaction not found",
          `Cannot found ${tx.txHash} delete and return sender to pool`
        )
        await tx.destroy()
      }
    } else {
      await alert(
        "Check transaction faced unexpected error",
        "Please look error from before incident"
      )
    }
  }
}

;(async () => {
  new CronJob("0 */10 * * * *", catchIncident(updateRate), null, true)
  new CronJob("*/15 * * * * *", catchIncident(checkTransaction), null, true)
})()
