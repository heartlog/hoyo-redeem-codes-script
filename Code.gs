const scriptProperties = PropertiesService.getScriptProperties();

/** REPLACE PARAMETERS WITH THE ONES YOU GOT **/
const profiles = {
  main: {
    'genshin': {
      'url': 'https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey?lang=en&game_biz=hk4e_global&uid=715052227&region=os_euro'
      },
    'hsr': {
      'url': 'https://sg-hkrpg-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkeyRisk',
      'request' : {"game_biz":"hkrpg_global", "uid":"701683615", "region":"prod_official_eur"}
      },
    'zzz': {
      'url': 'https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey?lang=en&game_biz=nap_global&uid=1500028068&region=prod_gf_eu'
      }
  }
};

const telegram_notify = true; // Changed from discord_notify
const myTelegramID = scriptProperties.getProperty('TELEGRAM_CHAT_ID'); // Your chat ID
const telegramBotToken = scriptProperties.getProperty('TELEGRAM_BOT_TOKEN'); // Your bot token

let keepCookieAlive = true;
const verbose = false;
let first_run = false;
let error = false;

const cdkeysbygame = fetchJson();
const last_execution = scriptProperties.getProperty('last_execution');
if (last_execution <= 0) {
  first_run = true;
}

function fetchJson() {
  const jsonUrl = 'https://db.hashblen.com/codes'; // Replace with your JSON endpoint URL
  const response = UrlFetchApp.fetch(jsonUrl);
  const jsonData = JSON.parse(response.getContentText());
  return jsonData;
}

const ALREADY_IN_USE = -2017;
const ALREADY_IN_USE_2 = -2018;
const EXPIRED = -2001;
const INVALID = -2003;
const SUCCESSFUL = 0;

function sendGetRequestsWithCdkeys(urlDict, profile) {
  let results = [];

  for (const game in urlDict) {
    const fullUrl = urlDict[game].url;
    if (!fullUrl) {
      continue;
    }
    const cdkeys = cdkeysbygame[game];
    cdkeys.forEach(function (cdkeydict) {
      if (!first_run && cdkeydict.added_at * 1000 < last_execution && !keepCookieAlive) {
        return;
      }
      const cookies = scriptProperties.getProperty('COOKIE_' + profile) ?? scriptProperties.getProperty(`COOKIE`);
      const cdkey = cdkeydict.code;

      const isRisk = 'request' in urlDict[game];
      const url = isRisk ? fullUrl : replaceCdkeyInUrl(fullUrl, cdkey);
      let options = {
        'method': isRisk ? 'post' : 'get',
        'headers': {
          'Cookie': `${cookies}`,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'x-rpc-app_version': '2.34.1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'x-rpc-client_type': '4',
        },
        'muteHttpExceptions': true
      };
      if (isRisk) {
        let body = { ...urlDict[game].request };
        body.cdkey = cdkey;
        body.lang = 'en';
        options.payload = JSON.stringify(body);
      }

      try {
        const response = UrlFetchApp.fetch(url, options);
        keepCookieAlive = false;
        const jsonData = JSON.parse(response.getContentText());
        const retcode = jsonData.retcode;
        if (![ALREADY_IN_USE, ALREADY_IN_USE_2, SUCCESSFUL].includes(retcode)) {
          error = true;
        }
        let resultText = `${game}: ${cdkey}: ${jsonData.message}`;
        if (verbose) {
          resultText += ` ${response}`;
        }
        Logger.log(resultText);
        if (verbose || ![ALREADY_IN_USE, ALREADY_IN_USE_2].includes(retcode)) {
          results.push(resultText);
        }
      } catch (e) {
        Logger.log(`${game}: Failed to send request for ${cdkey}: ${e.message}`);
        results.push(`${game}: ${cdkey}: Failed to send request`);
        error = true;
      }
      Utilities.sleep(5500);
    });
  }

  return results;
}

function replaceCdkeyInUrl(url, cdkey) {
  let cleanedUrl = url.replace(/cdkey=[^&]*(&)?/, '');
  cleanedUrl = cleanedUrl.replace(/[\?&]$/, '');
  const separator = cleanedUrl.includes('?') ? '&' : '?';
  return `${cleanedUrl}${separator}cdkey=${cdkey}`;
}

function first_main() {
  Logger.log("Running first_main, only run this the first time or when you had errors for more than a day so that you test old but not expired codes too.");
  first_run = true;
  main();
}

function main() {
  let startExec = Date.now().toString();
  const hoyoResp = Object.getOwnPropertyNames(profiles)
    .map(name => {
      const results = sendGetRequestsWithCdkeys(profiles[name], name);
      if (results) {
        return results.map(result => `${name}: ${result}`).flat();
      }
      return [];
    })
    .flat();

  if (telegram_notify && hoyoResp.length > 0) {
    sendTelegram(hoyoResp);
  }

  if (!error) {
    scriptProperties.setProperty('last_execution', startExec);
  }
}

// ---------------------------
// Telegram notification functions
// ---------------------------

function telegramPing() {
  return error ? "⚠️ Error occurred during code redemption!" : "✅ Redemption codes processed successfully!";
}

function sendTelegram(data) {
  const token = telegramBotToken;
  const chatId = myTelegramID;
  if (!token || !chatId) {
    Logger.log('Telegram token or chat ID not set.');
    return;
  }

  let currentChunk = `${telegramPing()}\n`;

  for (let i = 0; i < data.length; i++) {
    if (currentChunk.length + data[i].length >= 4000) { // Telegram message limit is 4096 chars
      postTelegram(currentChunk, token, chatId);
      currentChunk = '';
    }
    currentChunk += `${data[i]}\n`;
  }
  if (currentChunk) {
    postTelegram(currentChunk, token, chatId);
  }
}

function postTelegram(message, token, chatId) {
  const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    'chat_id': chatId,
    'text': message,
    'parse_mode': 'Markdown'
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(telegramUrl, options);
  Logger.log(`Posted to Telegram, returned: ${response.getContentText()}`);
}
