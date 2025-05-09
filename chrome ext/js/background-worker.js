// Import required libraries
import { API } from './api.js';
import { Config, getFingerprint, CBSInstallControl } from '../config.js';

// Load psl library
let psl;
import('/libs/psl.min.js').then(pslModule => {
  psl = pslModule.default || pslModule;
  console.log('PSL module loaded');
}).catch(err => {
  console.error('Failed to load PSL module:', err);
});

// Initialize global variables
let lastUrl = [];
let mainAPI = API();
let config = Config();

// Add a listener for when the service worker is installed
self.addEventListener('install', (event) => {
  console.log('Service worker installed');
  // Skip waiting to ensure the service worker is activated immediately
  self.skipWaiting();
});

// Add a listener for when the service worker is activated
self.addEventListener('activate', (event) => {
  console.log('Service worker activated');
  // Claim clients to ensure the service worker takes control immediately
  event.waitUntil(clients.claim());
});

// Tab update listener
chrome.tabs.onUpdated.addListener(process);

function arrayContains(needle, arrhaystack) {
  if(typeof arrhaystack === 'undefined')
    return false;
  return (arrhaystack.indexOf(needle) > -1);
}

function getDomain(url) {
  try {
    return url.match(/:\/\/(.[^/]+)/)[1];
  } catch (e) {
    console.error('Error getting domain from URL:', url, e);
    return '';
  }
}

function process(tabId, changeInfo, tab) {
  if (changeInfo.status === "loading") {
    // loading active: true
    chrome.tabs.query({status:'loading'}, function (tabs) {
      if(tabs.length && tabs[0].url && tabs[0].url.indexOf("chrome://") < 0) {
        checkUrl(tabs[0].url, tabs[0]);
        console.log('----------------');
      }
    });
  }
}

function checkUrl(checkUrl, currentTab) {
  if(!currentTab || !currentTab.url) return;
  
  let currentDomain = getDomain(currentTab.url);
  if(currentDomain === mainAPI.domain) {
    if(arrayContains(mainAPI.domain, lastUrl[currentTab.id]) === false) {
      if(typeof lastUrl[currentTab.id] === 'undefined') {
        lastUrl[currentTab.id] = [mainAPI.domain];
      } else {
        lastUrl[currentTab.id].push(mainAPI.domain);
      }
    }
  }
  
  // Use fetch API for network requests
  fetch(mainAPI.checkUrl(checkUrl))
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(response => {
      if(response && response.data && typeof response.data.go_link !== "undefined") {
        if(arrayContains(getDomain(currentTab.url), lastUrl[currentTab.id]) === false) {
          if(typeof lastUrl[currentTab.id] === 'undefined') {
            lastUrl[currentTab.id] = [getDomain(currentTab.url)];
          } else {
            lastUrl[currentTab.id].push(getDomain(currentTab.url));
          }
        }
        
        // Handle case when psl might not be loaded yet
        if (psl) {
          const tabDomain = psl.parse(getDomain(currentTab.url)).domain;
          chrome.storage.local.get(tabDomain, function(result) {
            isShowActivateCashback(result, response, currentTab);
            console.log('Storage ', result);
          });
        } else {
          console.log('PSL not loaded yet, retrying in 500ms');
          setTimeout(() => {
            if (psl) {
              const tabDomain = psl.parse(getDomain(currentTab.url)).domain;
              chrome.storage.local.get(tabDomain, function(result) {
                isShowActivateCashback(result, response, currentTab);
                console.log('Storage ', result);
              });
            } else {
              console.error('PSL still not loaded after retry');
            }
          }, 500);
        }
      }
    })
    .catch(error => {
      console.error('Error checking URL:', error);
    });
}

function isShowActivateCashback(storage, response, tab) {
  if(!tab || !tab.url || !psl) return;
  
  var tabDomain = psl.parse(getDomain(tab.url)).domain;
  var params = getUrlVars(tab.url);
  var CPAtoken = getCPAToken(params);
  var isNeedRedirect = true;
  var isHaveDomain = arrayContains(mainAPI.domain, lastUrl[tab.id]);
  console.log('Tab domain ', tabDomain);
  console.log('Main Domain ', mainAPI.domain);
  console.log('Last Url', lastUrl[tab.id]);
  console.log('CPAtoken', CPAtoken);

  if(tabDomain === mainAPI.domain) {
    return true;
  }

  if(typeof lastUrl[tab.id] !== 'undefined' && 
     lastUrl[tab.id].length > 0 && 
     lastUrl[tab.id][0] === mainAPI.domain) {
    if(CPAtoken !== '' && CPAtoken !== storage[tabDomain]) {
      setStorage(tabDomain, CPAtoken, tab);
      return true;
    }
  }

  if(typeof storage[tabDomain] !== 'undefined' && CPAtoken !=='' && CPAtoken !== storage[tabDomain]) {
    chrome.storage.local.remove(tabDomain, function () {
      console.log('Removed ', tabDomain);
      redirectAutoActivate(response, tab, tabDomain);
    });
    return true;
  }

  if(CPAtoken !=='' && isHaveDomain && tabDomain !== mainAPI.domain) {
    setStorage(tabDomain, CPAtoken, tab);
    isNeedRedirect = false;
    lastUrl[tab.id] = [];
  }

  if(typeof storage[tabDomain] === 'undefined') {
    console.log('isNeedRedirect', isNeedRedirect);

    if(isNeedRedirect === true) {
      redirectAutoActivate(response, tab, tabDomain);
    }

    if(response.isAuth === false) {
      getRedInfoBlock(response, tab);
    }
  }
}

function redirectAutoActivate(response, tab, tabDomain) {
  if(response.isAuth === false) {
    return true;
  }

  if(tabDomain === mainAPI.domain) {
    return true;
  }

  if(!arrayContains(mainAPI.domain, tab.url)) {
    let link = mainAPI.getGoRedirectShop(response.data.id, tab.url);
    console.log('REDIRECT!!! ', link);
    chrome.tabs.update(tab.id, {url: link});
  }
}

function getCPAToken(params) {
  var CPAtoken = '';

  //Convertiser,sellaction,advertise,TradeTrecker
  if(typeof params['utm_source'] !== 'undefined') {
    CPAtoken = params['utm_source'];
  }

  //admitad
  if(typeof params['admitad_uid'] !== 'undefined') {
    CPAtoken = params['admitad_uid'];
  }

  //admitad
  if(typeof params['tagtag_uid'] !== 'undefined') {
    CPAtoken = params['tagtag_uid'];
  }

  //aliexpress
  if(typeof params['aff_trace_key'] !== 'undefined') {
    CPAtoken = params['aff_trace_key'];
  }

  //sellaction
  if(typeof params['SAuid'] !== 'undefined') {
    CPAtoken = params['SAuid'];
  }

  //advertise
  if(typeof params['utm_campaign'] !== 'undefined' && params['utm_campaign'] === "advertise") {
    CPAtoken = params['utm_campaign'];
  }

  //advertise
  if(typeof params['uid'] !== 'undefined') {
    CPAtoken = params['uid'];
  }

  //7offers
  if(typeof params['tid'] !== 'undefined' && (params['utm_source'] === "7offers" || params['from'] === "7offers")) {
    CPAtoken = params['tid'];
  }

  //7offers
  if(typeof params['utm_term'] !== 'undefined' && params['utm_source'] === "7offers") {
    CPAtoken = params['utm_term'];
  }

  //awin
  if(typeof params['awc'] !== 'undefined') {
    CPAtoken = params['awc'];
  }

  //cj
  if(typeof params['utm_term'] !== 'undefined' && params['utm_source'] === "cj") {
    CPAtoken = params['utm_campaign'];
  }

  //cj
  if(typeof params['sskey'] !== 'undefined') {
    CPAtoken = params['sskey'];
  }

  //Convertiser
  if(typeof params['guid'] !== 'undefined') {
    CPAtoken = params['guid'];
  }

  //TradeTrecker (tradedoubler)
  if(typeof params['epi'] !== 'undefined') {
    CPAtoken = params['epi'];
  }
  //cityads - no main link in referer
  //webepartners - no main link in referer

  return CPAtoken;
}

function getRedInfoBlock(response, tab) {
  if (tab.url.indexOf("chrome-devtools://") === -1) {
    // Use fetch instead of $.get
    fetch(chrome.runtime.getURL('templates/cashbackNotActive.html'))
      .then(response => response.text())
      .then(data => {
        let link = mainAPI.getLoginUrl(tab.url);
        let textHtml = data.replace(/(\r\n|\n|\r)/gm, "");
        textHtml = textHtml.replace('#link#', link);
        if(response.isAuth === false) {
          textHtml = textHtml.replace('#text#', getTranslateNoAuthNotActive());
        }
        
        // Execute script in the tab context to show the notification
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: (htmlContent) => {
            if (window.getRedBlock) {
              window.getRedBlock(htmlContent);
            } else {
              console.error('getRedBlock function not found');
            }
          },
          args: [textHtml]
        }).catch(err => console.error('Error executing script:', err));
      })
      .catch(error => {
        console.error('Error getting template:', error);
      });
  }
}

function getGreenInfoBlock(tab) {
  if (tab.url.indexOf("chrome-devtools://") === -1) {
    // Use fetch instead of $.get
    fetch(chrome.runtime.getURL('templates/cashbackActive.html'))
      .then(response => response.text())
      .then(data => {
        var textHtml = data.replace(/(\r\n|\n|\r)/gm, "");
        textHtml = textHtml.replace('#text#', getTranslateActive());
        
        // Execute script in the tab context to show the notification
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: (htmlContent) => {
            if (window.getGreenBlock) {
              window.getGreenBlock(htmlContent);
            } else {
              console.error('getGreenBlock function not found');
            }
          },
          args: [textHtml]
        }).catch(err => console.error('Error executing script:', err));
      })
      .catch(error => {
        console.error('Error getting template:', error);
      });
  }
}

function setStorage(keyVal, val, tab) {
  var key = keyVal;
  var jsonfile = {};
  jsonfile[key] = val;

  chrome.storage.local.set(jsonfile, function () {
    console.log('Saved', key, val);
    getGreenInfoBlock(tab);
  });
}

function getUrlVars(urlFull) {
  var vars = {};
  var parts = urlFull.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m, key, value) {
    vars[key] = value;
  });
  return vars;
}

function getTranslateActive() {
  const list = {
    'en':'Cashback successfully activated!',
    'ru':'Кэшбэк успешно активирован!',
    'pl':'Cashback pomyślnie aktywowany!'
  };
  return list[mainAPI.lang];
}

function getTranslateNoAuthNotActive() {
  const list = {
    'en':'To receive cashback upon purchase, you need to log in! For authorization, click here.',
    'ru':'Для получения кэшбэка при покупке, вам нужно авторизоваться! Для авторизации нажмите тут.',
    'pl':'Aby otrzymać cashback przy zakupie, musisz się zalogować! Aby uzyskać autoryzację, kliknij tutaj.'
  };
  return list[mainAPI.lang];
}

async function sendInstallPromoSurfer(mainAPI) {
  try {
    const response = await fetch(mainAPI.getPromoSurferBotCookie());
    const data = await response.json();
    console.log('f sendInstallPromoSurfer(mainAPI) #1 data => ', data);
    
    if(data.UserID !== undefined) {
      const activationResponse = await fetch(mainAPI.getPromoSurferActivation(), {
        method: 'POST',
        body: JSON.stringify({
          UserID: data.UserID,
          TaskID: data.TaskID,
          Status: true
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const activationData = await activationResponse.json();
      console.log('f sendInstallPromoSurfer(mainAPI) #2 data => ', activationData);
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

async function sendInstallCashback(mainAPI) {
  try {
    console.log('f sendInstallCashback(mainAPI)...');
    let fp = await getFingerprint();
    console.log('fp =>', fp);
    
    const response = await fetch(mainAPI.getCashbackInstallCount(fp));
    const data = await response.json();
    
    console.log('f sendInstallCashback(mainAPI)... data => ', data);
    if (data.install_id !== undefined) {
      chrome.storage.local.set({install_id: data.install_id});
    }
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

function sendRequestToCheckAlive() {
  chrome.storage.local.get(['lastTimeAlive'], function(result) {
    if (result.lastTimeAlive === undefined) {
      sendActiveRequest();
    } else {
      var lastCheckTimeInMs = result.lastTimeAlive;
      var currentTimeInMs = Date.now();
      if (lastCheckTimeInMs < currentTimeInMs) {
        sendActiveRequest();
      }
    }
  });
}

function sendActiveRequest() {
  console.log('f sendActiveRequest() started...');
  chrome.storage.local.get(['install_id'], function(result) {
    var thisVersion = chrome.runtime.getManifest().version;
    var extensionId = chrome.runtime.id;
    var timeToCheck = 12;
    var timeInMs = new Date();
    timeInMs.setHours(timeInMs.getHours() + timeToCheck);
    
    if (result.install_id === undefined) {
      sendInstallCashback(mainAPI);
    } else {
      fetch(mainAPI.getCashbackAlive(result.install_id, thisVersion, extensionId), {mode: 'cors'})
        .then(response => response.json())
        .then(data => {
          if (data.install_id === 0) {
            sendInstallCashback(mainAPI);
          } else {
            chrome.storage.local.set({lastTimeAlive: timeInMs.getTime()});
          }
        })
        .catch(error => {
          console.error('Error in sendActiveRequest:', error);
        });
    }
    console.log('f sendActiveRequest() ... install_id = ' + result.install_id);
  });
}

// Chrome runtime events
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === "install") {
    sendInstallPromoSurfer(mainAPI);
    CBSInstallControl.activity();
  } else if(details.reason === "update") {
    var thisVersion = chrome.runtime.getManifest().version;
    console.log("Updated from " + details.previousVersion + " to " + thisVersion + "!");
  }
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if(changeInfo.status === 'loading') {
    CBSInstallControl.activity();
  }
});
