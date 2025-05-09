// Export Config as an ES module
export function Config() {
    let self = {};
    self.isProduction = true;
    self.domain_p = 'https://';
    self.domain = 'cashback-bot.com';
    self.devDomain_p = 'http://';
    self.devDomain = 'cashbackcms.loc';
    self.lang = 'ru';
    self.apiversion = 'v1';

    self.getDomain = function () {
        if (self.isProduction){
            return self.domain_p + self.domain
        }
        return self.devDomain_p + self.devDomain
    }

    self.getDomainWithoutProtocol = function () {
        if (self.isProduction) {
            return self.domain
        }
        return self.devDomain
    }

    self.getApiDomain = function () {
        if (self.isProduction) {
            return self.domain_p + self.domain + '/' + self.apiversion + '/'
        }
        return self.devDomain_p + self.devDomain + '/' + self.apiversion + '/'
    }
    return self;
};
// ============================================================================
export async function getFingerprint() {
        const fpPromise = import('https://openfpcdn.io/fingerprintjs/v3')
        .then(FingerprintJS => FingerprintJS.load())
        const fp = await fpPromise
        const result = await fp.get()
        return result.visitorId;
}
// ============================================================================
export const SafeTimer = {
    period: 1000,

    work: function (label) {
        console.log(".work() called!", label)
    },

    skip: function (left) {
        console.log(".skip() called!", left)
    },    

    activity: function () {
        console.log(".activity() called!")
        let self = this;

        chrome.storage.local.get(['lastTimeActivity'], function(result) {
            let timeInMs = Date.now();
            if (result.lastTimeActivity === undefined) {
                chrome.storage.local.set({lastTimeActivity: timeInMs}, function() {
                    self.work('first');
                })
            } else {
                let leftInMs = result.lastTimeActivity + self.period - timeInMs
                if (leftInMs <= 0) {
                    chrome.storage.local.set({lastTimeActivity: timeInMs}, function() {
                        self.work('second');
                    })
                } else {
                    self.skip(leftInMs);
                }
            }
            setTimeout( () => { self.activity() }, self.period)
        })
    }

}

export function contains(arr, elem) {
   return arr.indexOf(elem) != -1;
}
// ============================================================================
export const readLocalStorage = async (key) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], function (result) {
        if (result[key] === undefined) {
          resolve(undefined);
        } else {
          resolve(result[key]);
        }
      });
    });
  };

export const saveLocalStorage = async (key, value) => {
    return new Promise((resolve, reject) => {
        var obj = {}; obj[key] = value;
        chrome.storage.local.set(obj, function (result) {
            resolve(value);
        });
    });
  };

export const readAllLocalStorage = async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({}, function (result) {
        if (result === undefined) {
          resolve(undefined);
        } else {
          resolve(result);
        }
      });
    });
  };  

export const clearLocalStorage = (keepKeys) => {
    let storage = readAllLocalStorage();
    console.log('f clearLocalStorage()... started');
    for (let key in storage) {
        let isRemovable = !contains(keepKeys, key)
        console.log(key, isRemovable);
        if (isRemovable) 
            chrome.storage.local.remove([key], function() {
                let error = chrome.runtime.lastError;
                if (error) { console.error('f clearLocalStorage()', error); }
                else { console.log('f clearLocalStorage() removed ok ..', key); }
        });
    }
  };
// ============================================================================  

// ============================================================================  
export const CBSInstallControl = {
    isInstalled: async function () {
        return new Promise((resolve, reject) => {
            readLocalStorage('install_id')
            .then( (install_id) => {
                //console.log('install_id --->', install_id);
                resolve(install_id > 0);
            })
        });
    },
    tryInstall: function () {
        this.sendInstallCount(mainAPI);
    },
    tryAlive: function () {
        this.sendAlive(mainAPI);
    },
    activity: function () {
        let self = this;
        self.isInstalled()
        .then((isInstalled) => {
            if (isInstalled) {
                self.tryAlive();
            } else {
                self.tryInstall();
            }
        });        
    },
    setInstallCode: async function () {
        try {
            var code = ""
            console.log('f .setInstallCode()... started');        
            let response = await fetch('https://api.taskhub1.com/v1/account/get-advanced-code')
            //let response = await fetch('http://devapi.taskhub1.com/v1/account/get-advanced-code');
            let data = await response.json();
            code = data.code;
            console.log('f .setInstallCode()... code retrieved by api => ', code);
            let isInstalled = await this.isInstalled();
            console.log('f .setInstallCode()... isInstalled => ', isInstalled);
            if (!isInstalled) code = ""; // удалим код если инсталл не был выполнен
            await saveLocalStorage("install_code", code);
        } catch (error) {
            console.error('f .setInstallCode() ... error catched => :', error);
        }
        console.log('f .setInstallCode()... code => ', code, code.length);
        return code;
    },
    loadInstallCode: async function () {
        try {
            var code = ""
            code = await readLocalStorage("install_code");
            let isCodeOk = (typeof code === "string" && code.length > 0);
            if (!isCodeOk) code = 'n/a';
        } catch (error) {
            console.error('f .loadInstallCode() ... error catched => :', error);
        }
        return code;
    },
    sendInstallCount: async function (mainAPI) {
        try {
            var result = false;
            console.log('f .sendInstallCount()... started');
            let fp = await getFingerprint();
            console.log('fp =>', fp);
            let response = await fetch(mainAPI.getCashbackInstallCount(fp))
            //console.log('f .sendInstallCount()... response => ', response);
            let data = await response.json();
            console.log('f .sendInstallCount()... recieved data => ', data);
            //data.install_id = 999; // отладка
            if (data.install_id > 0) {
                // инсталяция выполнена успешно
                result = true;
                //chrome.storage.local.set({install_id: data.install_id});
                await saveLocalStorage("install_id", data.install_id);
                // установим код тк успешно прошла инсталляция
                this.setInstallCode();
                console.log('f .sendInstallCount()... (data.install_id > 0) => ', data.install_id);
            } else {
                console.log('f .sendInstallCount()... !(data.install_id > 0) => ', data.install_id);
            }
        } catch (error) {
            console.error('f .sendInstallCount() ... error catched => :', error);
        }
        return result;
    },
    sendAlive: async function (mainAPI) {
        try {
            var result = false;
            console.log('f .sendAlive()... started');
            var install_id = await readLocalStorage('install_id');
            var thisVersion = chrome.runtime.getManifest().version;
            var extensionId = chrome.runtime.id;
            //var install_id = 366;
            console.log('f .sendAlive() ... chrome.storage.local -> install_id = ' + install_id);
            if (install_id > 0) {
                let lPromise = fetch(mainAPI.getCashbackAlive(install_id, thisVersion, extensionId), {mode: 'cors'})
                .then((response) => {
                        return response.json();
                })
                .then((data) => {
                    console.log('f .sendAlive()... recieved data => ', data);
                    if (data.install_id > 0) {
                        result = true;
                        chrome.storage.local.set({install_id: data.install_id});
                        console.log('f .sendAlive()... data.install_id > 0 => ', data.install_id);
                    } else {
                        console.log('f .sendAlive()... !data.install_id > 0 => ', data.install_id);
                    }
                });
                await lPromise;
            }

        } catch (error) {
            console.error('f .sendInstallCount() ... error catched => :', error);
        }
        return result;
    }
}

// Definition of a global mainAPI variable needed by CBSInstallControl
let mainAPI;
try {
    // This will be properly initialized in the service worker where this module is imported
    mainAPI = {};
} catch (e) {
    console.error("mainAPI initialization error:", e);
}
