const axios = require("axios")

const config = require("./config")

function catchIncident(f) {
  return async function() {
    try {
      const result = await f.apply(this, arguments)
      return result
    } catch (e) {
      await alert("Exception raised", e)
    }
  }
}

const alert = async (title, details) => {
  let dedup = config.TARGET_NETWORK + "." + title
  return axios.post(
    "https://events.pagerduty.com/v2/enqueue",
    {
      payload: {
        summary: `${config.TARGET_NETWORK}: ${title}`,
        custom_details: details,
        severity: "critical",
        source: config.TARGET_NETWORK
      },
      event_action: "trigger",
      routing_key: config.ROUTING_KEY,
      dedup_key: dedup
    },
    {
      headers: {
        Authorization: "Token token=" + config.API_TOKEN,
        From: "app@bandprotocol.com",
        "Content-Type": "application/json",
        Accept: "application/vnd.pagerduty+json;version=2"
      }
    }
  )
}

module.exports = { alert, catchIncident }
