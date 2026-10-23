(function (global) {
  var LOG = "[GalleryApi]";
  var unityGameObject = "GalleryWalletBridge";
  var lastNonce = null;
  var lastNonceWallet = "";
  var lastAuth = null;

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG);
    console.log.apply(console, args);
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG);
    console.warn.apply(console, args);
  }

  function getApiBase() {
    var base = global.METAGRAFF_API_BASE_URL || "";
    return String(base).replace(/\/$/, "");
  }

  function healthUrl(base) {
    if (!base) return "";
    if (/\/mock$/i.test(base) || /\/api$/i.test(base)) return base + "/health";
    return base + "/api/health";
  }

  function nonceUrls(base, wallet) {
    var query = "?wallet=" + encodeURIComponent(wallet);
    return [
      base + "/api/api/auth/nonce" + query,
      base + "/api/auth/nonce" + query
    ];
  }

  function connectUrls(base) {
    return [
      base + "/api/api/auth/connect",
      base + "/api/auth/connect"
    ];
  }

  function setSignInLabel(label) {
    var button = document.getElementById("api-run-connect");
    if (button) button.textContent = label || "Sign in";
  }

  function setPanel(text, chipLabel) {
    var node = document.getElementById("api-log");
    if (node) node.textContent = text;
    if (!chipLabel) return;
    if (chipLabel.indexOf("API health") === 0) {
      var chip = document.getElementById("api-chip-label");
      if (chip) chip.textContent = chipLabel;
      return;
    }
    if (chipLabel === "Signed in ✓") setSignInLabel("Signed in");
    else if (chipLabel.indexOf("Sign in") === 0) setSignInLabel("Sign in");
  }

  function notifyPointerDown() {
    if (global.document && typeof global.document.exitPointerLock === "function") {
      global.document.exitPointerLock();
    }
    var instance = global.unityInstance;
    if (!instance || typeof instance.SendMessage !== "function") return;
    instance.SendMessage(unityGameObject, "OnWalletUiPointerDown", "");
  }

  function showPanel() {
    var panel = document.getElementById("api-panel");
    if (panel) panel.hidden = false;
  }

  function parseBody(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return text;
    }
  }

  function prettyBody(body) {
    return typeof body === "string" ? body : JSON.stringify(body, null, 2);
  }

  function shouldTryAlternateNoncePath(status) {
    return status === 404;
  }

  function getJson(url) {
    log("GET", url);
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    }).then(function (res) {
      return res.text().then(function (text) {
        return {
          ok: res.ok,
          status: res.status,
          url: url,
          body: parseBody(text)
        };
      });
    });
  }

  function postJson(url, payload) {
    log("POST", url);
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        return {
          ok: res.ok,
          status: res.status,
          url: url,
          body: parseBody(text)
        };
      });
    });
  }

  function nonceStillValid(nonce, wallet) {
    if (!nonce || !nonce.message || !wallet) return false;
    if (lastNonceWallet && lastNonceWallet !== wallet) return false;
    if (nonce.message.indexOf(wallet) === -1) return false;
    if (!nonce.expiresAt) return true;
    var expires = Date.parse(nonce.expiresAt);
    if (isNaN(expires)) return false;
    return expires - 5000 > Date.now();
  }

  function previewToken(token) {
    if (!token || typeof token !== "string") return "";
    if (token.length <= 24) return token.slice(0, 8) + "…";
    return token.slice(0, 12) + "…" + token.slice(-6);
  }

  function summarizeAuth(body) {
    if (!body || typeof body !== "object") return prettyBody(body);
    var user = body.user || {};
    return [
      "expiresIn: " + (body.expiresIn == null ? "" : body.expiresIn),
      "user.walletAddress: " + (user.walletAddress || ""),
      "token: " + previewToken(body.token) + " (kept in memory)"
    ].join("\n");
  }

  function errorMessage(err) {
    if (!err) return "Unknown error";
    if (err.code === 4001 || err.code === "4001") return "Sign in cancelled";
    return err.message || err.code ? String(err.message || err.code) : String(err);
  }

  function connectedWallet() {
    return global.MetaGraffWallet && typeof global.MetaGraffWallet.getPublicKey === "function"
      ? global.MetaGraffWallet.getPublicKey()
      : "";
  }

  function runHealthCheck() {
    var base = getApiBase();
    var url = healthUrl(base);
    if (!url) {
      warn("API base URL is missing");
      setPanel("API base URL is missing", "API health ✗");
      return Promise.resolve();
    }

    setPanel("GET " + url + " …", "API health …");

    return getJson(url).then(function (result) {
      var summary = "HTTP " + result.status + " " + result.url + "\n" + prettyBody(result.body);
      if (!result.ok) {
        warn("Health failed", result.status, result.body);
        setPanel(summary, "API health ✗");
        return result.body;
      }
      log("Health result", result.body);
      setPanel(summary, "API health ✓");
      return result.body;
    }).catch(function (err) {
      var message = err && err.message ? err.message : String(err);
      warn("Health request failed", message);
      setPanel("Health request failed: " + message, "API health ✗");
    });
  }

  function fetchNonce(wallet) {
    var pubkey = wallet || connectedWallet();
    var base = getApiBase();
    showPanel();
    log("Get nonce clicked", pubkey || "(no wallet connected)");

    if (!base) {
      warn("API base URL is missing");
      setPanel("API base URL is missing", "Nonce ✗");
      return Promise.resolve();
    }

    if (!pubkey) {
      warn("Connect a wallet before requesting a nonce");
      setPanel(
        "Connect Phantom or Solflare first, then Get nonce.\nThe nonce call needs ?wallet=<pubkey>.",
        "Nonce ✗"
      );
      return Promise.resolve();
    }

    var urls = nonceUrls(base, pubkey);
    setPanel("GET " + urls[0] + " …", "Nonce …");

    function handleResult(result, remaining) {
      if (shouldTryAlternateNoncePath(result.status) && remaining.length) {
        var next = remaining[0];
        log("Nonce path 404; trying alternate", next);
        setPanel("GET " + next + " …", "Nonce …");
        return getJson(next).then(function (retry) {
          return handleResult(retry, remaining.slice(1));
        });
      }

      var summary = "HTTP " + result.status + " " + result.url + "\n" + prettyBody(result.body);
      if (!result.ok) {
        lastNonce = null;
        lastNonceWallet = "";
        warn("Nonce failed", result.status, result.body);
        setPanel(summary, "Nonce ✗");
        return result.body;
      }

      lastNonce = result.body && typeof result.body === "object" ? result.body : null;
      lastNonceWallet = lastNonce && lastNonce.message ? pubkey : "";
      log("Nonce result", result.body);
      setPanel(summary, "Nonce ✓");
      return result.body;
    }

    return getJson(urls[0]).then(function (result) {
      return handleResult(result, urls.slice(1));
    }).catch(function (err) {
      lastNonce = null;
      lastNonceWallet = "";
      var message = err && err.message ? err.message : String(err);
      warn("Nonce request failed", message);
      setPanel("Nonce request failed: " + message, "Nonce ✗");
    });
  }

  function postConnect(wallet, message, signature) {
    var base = getApiBase();
    var urls = connectUrls(base);
    var payload = {
      wallet: wallet,
      message: message,
      signature: signature
    };
    setPanel("POST " + urls[0] + " …", "Sign in …");

    function handleResult(result, remaining) {
      if (shouldTryAlternateNoncePath(result.status) && remaining.length) {
        var next = remaining[0];
        log("Connect path 404; trying alternate", next);
        setPanel("POST " + next + " …", "Sign in …");
        return postJson(next, payload).then(function (retry) {
          return handleResult(retry, remaining.slice(1));
        });
      }

      if (!result.ok) {
        lastAuth = null;
        warn("Connect failed", result.status, result.body);
        setPanel(
          "HTTP " + result.status + " " + result.url + "\n" + prettyBody(result.body),
          "Sign in ✗"
        );
        return result.body;
      }

      lastAuth = result.body && typeof result.body === "object" ? result.body : null;
      log("Connect result", {
        expiresIn: lastAuth && lastAuth.expiresIn,
        user: lastAuth && lastAuth.user,
        token: previewToken(lastAuth && lastAuth.token)
      });
      setPanel(
        "HTTP " + result.status + " " + result.url + "\n" + summarizeAuth(lastAuth),
        "Signed in ✓"
      );
      return lastAuth;
    }

    return postJson(urls[0], payload).then(function (result) {
      return handleResult(result, urls.slice(1));
    });
  }

  function connectWithWallet() {
    var pubkey = connectedWallet();
    var walletName = global.MetaGraffWallet && typeof global.MetaGraffWallet.getWalletName === "function"
      ? global.MetaGraffWallet.getWalletName()
      : "";
    showPanel();
    notifyPointerDown();
    log("Sign in clicked", pubkey || "(no wallet connected)");

    if (!getApiBase()) {
      warn("API base URL is missing");
      setPanel("API base URL is missing", "Sign in ✗");
      return Promise.resolve();
    }

    if (!pubkey) {
      warn("Connect a wallet before signing in");
      setPanel(
        "Connect Phantom or Solflare first, then Sign in.\nThe connect call needs wallet + signed nonce message.",
        "Sign in ✗"
      );
      return Promise.resolve();
    }

    if (!global.MetaGraffWallet || typeof global.MetaGraffWallet.signMessage !== "function") {
      warn("Wallet bridge cannot signMessage");
      setPanel("Wallet bridge cannot signMessage. Hard-refresh the page.", "Sign in ✗");
      return Promise.resolve();
    }

    function signAndPost(nonceBody) {
      if (!nonceBody || !nonceBody.message) {
        warn("No nonce message to sign");
        setPanel("Get nonce first, or wait for a nonce JSON with a message field.", "Sign in ✗");
        return null;
      }

      setPanel(
        "Approve the sign-in message in " + (walletName || "your wallet") + " …",
        "Sign in …"
      );

      return global.MetaGraffWallet.signMessage(nonceBody.message).then(function (signature) {
        log("Message signed", previewToken(signature));
        return postConnect(pubkey, nonceBody.message, signature).then(function (body) {
          lastNonce = null;
          lastNonceWallet = "";
          return body;
        });
      });
    }

    var noncePromise = nonceStillValid(lastNonce, pubkey)
      ? Promise.resolve(lastNonce)
      : fetchNonce(pubkey);

    return noncePromise.then(function (nonceBody) {
      return signAndPost(nonceBody);
    }).catch(function (err) {
      lastAuth = null;
      var message = errorMessage(err);
      warn("Sign in failed", message);
      setPanel("Sign in failed: " + message, "Sign in ✗");
    });
  }

  function clearAuth() {
    lastAuth = null;
    lastNonce = null;
    lastNonceWallet = "";
    setSignInLabel("Sign in");
  }

  function bindOverlay() {
    var root = document.getElementById("api-overlay");
    if (!root) return;

    root.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
      notifyPointerDown();
    });

    var chip = document.getElementById("api-chip");
    var panel = document.getElementById("api-panel");
    if (chip && panel) {
      chip.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
      });
    }

    var healthButton = document.getElementById("api-run-health");
    if (healthButton) {
      healthButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        runHealthCheck();
      });
    }

    var nonceButton = document.getElementById("api-run-nonce");
    if (nonceButton) {
      nonceButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        fetchNonce();
      });
    }

    var connectButton = document.getElementById("api-run-connect");
    if (connectButton) {
      connectButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        connectWithWallet();
      });
    }

    runHealthCheck();
  }

  global.MetaGraffApi = {
    runHealthCheck: runHealthCheck,
    fetchNonce: fetchNonce,
    connectWithWallet: connectWithWallet,
    clearAuth: clearAuth,
    getLastNonce: function () {
      return lastNonce;
    },
    getAuthToken: function () {
      return lastAuth && lastAuth.token ? lastAuth.token : "";
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOverlay);
  } else {
    bindOverlay();
  }
})(window);
