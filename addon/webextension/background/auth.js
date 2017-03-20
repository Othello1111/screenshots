/* globals browser */
/* globals main, makeUuid, deviceInfo, analytics, catcher, defaultSentryDsn, communication */

window.auth = (function () {
  let exports = {};

  let registrationInfo;
  let initialized = false;
  let authHeader = null;
  let sentryPublicDSN = null;
  let abTests = {};

  catcher.watchPromise(browser.storage.local.get(["registrationInfo", "abTests"]).then((result) => {
    if (result.abTests) {
      abTests = result.abTests;
    }
    if (result.registrationInfo) {
      registrationInfo = result.registrationInfo;
    } else {
      registrationInfo = generateRegistrationInfo();
      console.info("Generating new device authentication ID", registrationInfo);
      return browser.storage.local.set({registrationInfo});
    }
  }));

  exports.getDeviceId = function () {
    return registrationInfo && registrationInfo.deviceId;
  };

  function generateRegistrationInfo() {
    let info = {
      deviceId: "anon" + makeUuid() + "",
      secret: makeUuid()+"",
      registered: false
    };
    return info;
  }

  function register() {
    return new Promise((resolve, reject) => {
      let registerUrl = main.getBackend() + "/api/register";
      let req = new XMLHttpRequest();
      req.open("POST", registerUrl);
      req.setRequestHeader("content-type", "application/x-www-form-urlencoded");
      req.onload = catcher.watchFunction(() => {
        if (req.status == 200) {
          console.info("Registered login");
          initialized = true;
          saveAuthInfo(JSON.parse(req.responseText));
          resolve(true);
          analytics.sendEvent("registered");
        } else {
          console.warn("Error in response:", req.responseText);
          reject(new Error("Bad response: " + req.status));
        }
      });
      req.send(uriEncode({
        deviceId: registrationInfo.deviceId,
        secret: registrationInfo.secret,
        deviceInfo: JSON.stringify(deviceInfo())
      }));
    });
  }

  function login(options) {
    let { ownershipCheck, noRegister } = options || {};
    return new Promise((resolve, reject) => {
      let loginUrl = main.getBackend() + "/api/login";
      let req = new XMLHttpRequest();
      req.open("POST", loginUrl);
      req.onload = catcher.watchFunction(() => {
        if (req.status == 404) {
          if (noRegister) {
            resolve(false);
          } else {
            resolve(register());
          }
        } else if (req.status >= 300) {
          console.warn("Error in response:", req.responseText);
          reject(new Error("Could not log in: " + req.status));
        } else if (req.status === 0) {
          let error = new Error("Could not log in, server unavailable");
          analytics.sendEvent("login-failed");
          reject(error);
        } else {
          initialized = true;
          let jsonResponse = JSON.parse(req.responseText);
          console.info("Page Shot logged in");
          analytics.sendEvent("login");
          saveAuthInfo(jsonResponse);
          if (ownershipCheck) {
            resolve({isOwner: jsonResponse.isOwner});
          } else {
            resolve(true);
          }
        }
      });
      req.setRequestHeader("content-type", "application/x-www-form-urlencoded");
      req.send(uriEncode({
        deviceId: registrationInfo.deviceId,
        secret: registrationInfo.secret,
        deviceInfo: JSON.stringify(deviceInfo()),
        ownershipCheck
      }));
    });
  }

  function saveAuthInfo(responseJson) {
    if (responseJson.sentryPublicDSN) {
      sentryPublicDSN = responseJson.sentryPublicDSN;
    }
    if (responseJson.authHeader) {
      authHeader = responseJson.authHeader;
      if (!registrationInfo.registered) {
        registrationInfo.registered = true;
        catcher.watchPromise(browser.storage.local.set({registrationInfo}));
      }
    }
    if (responseJson.abTests) {
      abTests = responseJson.abTests;
      catcher.watchPromise(browser.storage.local.set({abTests}));
    }
  }

  function uriEncode(obj) {
    let s = [];
    for (let key in obj) {
      if (obj[key] !== undefined) {
        s.push(`${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`);
      }
    }
    return s.join("&");
  }

  exports.getDeviceId = function () {
    return registrationInfo.deviceId;
  };

  exports.authHeaders = function () {
    let initPromise = Promise.resolve();
    if (! initialized) {
      initPromise = login();
    }
    return initPromise.then(() => {
      if (authHeader) {
        return {"x-pageshot-auth": authHeader};
      } else {
        console.warn("No auth header available");
        return {};
      }
    });
  };

  exports.getSentryPublicDSN = function () {
    return sentryPublicDSN || defaultSentryDsn;
  };

  exports.getAbTests = function () {
    return abTests;
  };

  exports.isRegistered = function () {
    return registrationInfo.registered;
  };

  exports.setDeviceInfoFromOldAddon = function (newDeviceInfo) {
    if (! (newDeviceInfo.deviceId && newDeviceInfo.secret)) {
      throw new Error("Bad deviceInfo");
    }
    if (registrationInfo.deviceId === newDeviceInfo.deviceId &&
      registrationInfo.secret === newDeviceInfo.secret) {
      // Probably we already imported the information
      return Promise.resolve(false);
    }
    let newInfo = {
      deviceId: newDeviceInfo.deviceId,
      secret: newDeviceInfo.secret,
      registered: true
    };
    initialized = false;
    return browser.storage.local.set({registrationInfo: newInfo}).then(() => {
      return true;
    });
  };

  communication.register("getAuthInfo", (sender, ownershipCheck) => {
    let info = registrationInfo;
    let done = Promise.resolve();
    if (info.registered) {
      done = login({ownershipCheck}).then((result) => {
        if (result && result.isOwner) {
          info.isOwner = true;
        }
      });
    }
    return done.then(() => {
      return info;
    });
  });

  return exports;
})();
