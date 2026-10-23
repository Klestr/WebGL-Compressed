(function (global) {
  var LOG = "[GalleryApi]";
  var unityGameObject = "GalleryWalletBridge";
  var lastNonce = null;

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

  function setPanel(text, chipLabel) {
    var node = document.getElementById("api-log");
    if (node) node.textContent = text;
    var chip = document.getElementById("api-chip-label");
    if (chip && chipLabel) chip.textContent = chipLabel;
  }

  function notifyPointerDown() {
    var instance = global.unityInstance;
    if (!instance || typeof instance.SendMessage !== "function") return;
    instance.SendMessage(unityGameObject, "OnWalletUiPointerDown", "");
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
        warn("Nonce failed", result.status, result.body);
        setPanel(summary, "Nonce ✗");
        return result.body;
      }

      lastNonce = result.body && typeof result.body === "object" ? result.body : null;
      log("Nonce result", result.body);
      setPanel(summary, "Nonce ✓");
      return result.body;
    }

    return getJson(urls[0]).then(function (result) {
      return handleResult(result, urls.slice(1));
    }).catch(function (err) {
      lastNonce = null;
      var message = err && err.message ? err.message : String(err);
      warn("Nonce request failed", message);
      setPanel("Nonce request failed: " + message, "Nonce ✗");
    });
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

    runHealthCheck();
  }

  global.MetaGraffApi = {
    runHealthCheck: runHealthCheck,
    fetchNonce: fetchNonce,
    getLastNonce: function () {
      return lastNonce;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOverlay);
  } else {
    bindOverlay();
  }
})(window);
