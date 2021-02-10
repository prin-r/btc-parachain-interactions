const { ApiPromise, WsProvider, Keyring } = require("@polkadot/api")
const { sendLoggedTx, getAPITypes, getRPCTypes } = require("@interlay/polkabtc")
const { U8aFixed } = require("@polkadot/types")
const Big = require("big.js")
const config = require("./config")
const { alert } = require("./notification")
const rpc = getRPCTypes()
const types = getAPITypes()
const BTC_DOT = "BTC_DOT"
const BTC_F = "BTC_F"
const BTC_HH = "BTC_HH"
const BTC_H = "BTC_H"

const zip = (rows) => rows[0].map((_, c) => rows.map((row) => row[c]))

const fromE9ToE18 = (x) => {
  const bx = new Big(x)
  return bx.mul(new Big(Math.pow(10, 9))).toFixed(0)
}

const sleep = async (t) => {
  return new Promise((r) => setTimeout(r, t))
}

const timeout = async (ms, promise, message) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${message}`))
    }, ms)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((reason) => {
        clearTimeout(timer)
        reject(reason)
      })
  })
}

const getAccount = () => {
  const keyring = new Keyring({ type: "sr25519" })
  return keyring.addFromUri(config.PRIVATE_KEY)
}

const getTxEventDataAtIndex = async (blockHashWithIndex) => {
  const provider = new WsProvider(config.INTERLAY_URL)
  try {
    const [blockHashHex, indexHex] = blockHashWithIndex.split("_")
    const blockHash = U8aFixed.from(Buffer.from(blockHashHex, "hex"))
    const api = await timeout(
      config.WS_TIMEOUT_QUERY,
      ApiPromise.create({ provider, rpc, types }),
      "WebSocket Timeout at getTxEventDataAtIndex create ws"
    )
    const events = await timeout(
      config.WS_TIMEOUT_QUERY,
      api.query.system.events.at(blockHash),
      "WebSocket Timeout at getTxEventDataAtIndex query event"
    )
    await provider.disconnect()

    for (let {
      event: { index, data },
    } of events.toHuman()) {
      if (index.toString() === indexHex) {
        return data
      }
    }

    return null
  } catch (e) {
    alert("Fail at getTxEventDataAtIndex", e)
  }
  await provider.disconnect()
  return null
}

const getTxHashFromEvents = (result, sender) => {
  let txHash = null
  if (result.status.isFinalized) {
    for (let {
      event: { index, data },
    } of result.toHuman().events) {
      if (data.includes(sender.address)) {
        txHash = `${result.status.asFinalized
          .toString()
          .replace("0x", "")}_${index}`
      }
    }
  }
  return txHash
}

const sendRelayTx = async (symbols, rates, requestIds, resolvedTimes) => {
  const provider = new WsProvider(config.INTERLAY_URL)
  try {
    const api = await timeout(
      config.WS_TIMEOUT_QUERY,
      ApiPromise.create({ provider, rpc, types }),
      "WebSocket Timeout at sendRelayTx create api"
    )
    const sender = getAccount()
    const relayData = zip([symbols, rates, requestIds, resolvedTimes])

    if (relayData.length === 1) {
      const btc_dot = relayData.find((e) => e[0] === BTC_DOT)
      if (!btc_dot) {
        throw "BTC_DOT not found"
      }
      const events = await timeout(
        config.WS_TIMEOUT_TX,
        sendLoggedTx(
          api.tx.exchangeRateOracle.setExchangeRate(
            api.createType("FixedU128", fromE9ToE18(btc_dot[1]))
          ),
          sender,
          api
        ),
        "WebSocket Timeout at sendRelayTx btc/dot"
      )
      await provider.disconnect()
      return getTxHashFromEvents(events, sender)
    } else if (relayData.length === 3) {
      const btc_f = relayData.find((e) => e[0] === BTC_F)
      const btc_hh = relayData.find((e) => e[0] === BTC_HH)
      const btc_h = relayData.find((e) => e[0] === BTC_H)
      if (!btc_f || !btc_hh || !btc_h) {
        throw `BTC_F or BTC_HH or BTC_H not found (${btc_f},${btc_hh},${btc_h})`
      }
      const events = await timeout(
        config.WS_TIMEOUT_TX,
        sendLoggedTx(
          api.tx.exchangeRateOracle.setBtcTxFeesPerByte(
            Math.round(btc_f[1] / 1e9),
            Math.round(btc_hh[1] / 1e9),
            Math.round(btc_h[1] / 1e9)
          ),
          sender,
          api
        ),
        "WebSocket Timeout at sendRelayTx btc fees"
      )
      await provider.disconnect()
      return getTxHashFromEvents(events, sender)
    }
  } catch (e) {
    await alert("Exception raised", e)
    console.log(e)
  }
  await provider.disconnect()
  return null
}

// Return status of transaction follow this
// 0 -> Transaction has been mined without error.
// Positive integer -> an error code from transaction process.
// -1 -> Transaction hasn't been processed after send.
// -2 -> Transaction just sent to the network
// null -> Unknown Error alert via pagerduty
const transactionStatus = async (txHash, createdAt) => {
  try {
    const txInfo = await getTxEventDataAtIndex(txHash)
    const sender = getAccount()
    if (txInfo.includes(sender.address)) {
      return 0
    }
    return -1
  } catch (err) {
    if (err.isAxiosError && err.response && err.response.status === 404) {
      if (new Date() - createdAt > config.TX_WAIT_PERIOD * 1000) {
        return -1
      } else {
        return -2
      }
    } else if (!err.isAxiosError) {
      await alert("Cannot get transaction detail", err.message)
    }
    await alert("Unexpected error", err)
  }
  return null
}

module.exports = {
  transactionStatus,
  sendRelayTx,
  getAccount,
  sleep,
  BTC_DOT,
  BTC_F,
  BTC_HH,
  BTC_H,
}
;(async () => {
  let i = 0
  const mockData = [
    [["BTC_DOT"], ["1888222760290"], [1], ["1612779534"]],
    [
      ["BTC_F", "BTC_HH", "BTC_H"],
      ["102000000000", "102000000000", "88000000000"],
      [2, 3, 4],
      ["1612779534", "1612779534", "1612779534"],
    ],
  ]

  while (true) {
    console.log("round:", i + 1)
    try {
      const [symbols, rates, reqIds, timestamps] = mockData[i % 2]
      const txHash = await sendRelayTx(symbols, rates, reqIds, timestamps)
      console.log(txHash)

      const status = await transactionStatus(txHash, Date.now())
      console.log(status)
    } catch (e) {
      console.log(JSON.stringify(e))
    }
    console.log(
      "=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-="
    )
    await sleep(10_000)
    i++
  }
})()
