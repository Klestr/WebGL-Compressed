(function (global) {
  var LOG = "[GalleryApi]";
  var unityGameObject = "GalleryWalletBridge";

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

  function setLog(text, isError) {
    var node = document.getElementById("api-log");
    if (node) node.textContent = text;
    var chip = document.getElementById("api-chip-label");
    if (chip) chip.textContent = isError ? "API health ✗" : "API health ✓";
  }

  function notifyPointerDown() {
    var instance = global.unityInstance;
    if (!instance || typeof instance.SendMessage !== "function") return;
    instance.SendMessage(unityGameObject, "OnWalletUiPointerDown", "");
  }

  function runHealthCheck() {
    var base = getApiBase();
    var url = healthUrl(base);
    if (!url) {
      warn("API base URL is missing");
      setLog("API base URL is missing", true);
      return Promise.resolve();
    }

    log("GET", url);
    setLog("GET " + url + " …");

    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = text;
        try {
          body = JSON.parse(text);
        } catch (err) {
          // Keep raw text when the host does not return JSON.
        }

        var pretty = typeof body === "string" ? body : JSON.stringify(body, null, 2);
        var summary = "HTTP " + res.status + " " + url + "\n" + pretty;

        if (!res.ok) {
          warn("Health failed", res.status, body);
          setLog(summary, true);
          return body;
        }

        log("Health result", body);
        setLog(summary, false);
        return body;
      });
    }).catch(function (err) {
      var message = err && err.message ? err.message : String(err);
      warn("Health request failed", message);
      setLog("Health request failed: " + message, true);
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

    var runButton = document.getElementById("api-run-health");
    if (runButton) {
      runButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        runHealthCheck();
      });
    }

    runHealthCheck();
  }

  global.MetaGraffApi = {
    runHealthCheck: runHealthCheck
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOverlay);
  } else {
    bindOverlay();
  }
})(window);
