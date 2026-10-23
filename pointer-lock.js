(function (global) {
  var LOG = "[GalleryPointer]";
  var suppressUntil = 0;
  var canvas = null;
  var hint = null;
  var restoreTimer = 0;
  var watching = false;

  function now() {
    return Date.now();
  }

  function isPointerLockError(reason) {
    if (!reason) return false;
    var name = reason.name || "";
    var message = String(reason.message || reason);
    if (name === "WrongDocumentError") return true;
    return /pointer lock/i.test(message);
  }

  function getCanvas() {
    return canvas || document.getElementById("unity-canvas");
  }

  function isLocked() {
    return !!document.pointerLockElement;
  }

  function restoreCursor() {
    if (isLocked()) return;
    var el = getCanvas();
    if (el) el.style.cursor = "default";
  }

  function hideCursor() {
    var el = getCanvas();
    if (el) el.style.cursor = "none";
  }

  function updateHint() {
    if (!hint) hint = document.getElementById("pointer-hint");
    if (!hint) return;
    hint.hidden = isLocked();
  }

  function syncUnlockedUi() {
    restoreCursor();
    updateHint();
  }

  function keepCursorVisible(ms) {
    syncUnlockedUi();
    var until = now() + (ms || 800);
    if (restoreTimer) {
      clearInterval(restoreTimer);
    }
    restoreTimer = setInterval(function () {
      if (isLocked() || now() > until) {
        clearInterval(restoreTimer);
        restoreTimer = 0;
        updateHint();
        return;
      }
      restoreCursor();
      updateHint();
    }, 50);
  }

  function notifyUnity(state) {
    var instance = global.unityInstance;
    if (!instance || typeof instance.SendMessage !== "function") return;
    instance.SendMessage("GalleryWalletBridge", "OnPointerLockChanged", state);
  }

  function suppress(ms) {
    suppressUntil = Math.max(suppressUntil, now() + (ms || 1200));
  }

  function wrapFunction(original) {
    if (!original || original.__metagraffPointerWrap) return original;

    var wrapped = function (options) {
      if (isLocked()) return Promise.resolve();
      if (now() < suppressUntil) {
        keepCursorVisible(800);
        return Promise.resolve();
      }

      try {
        var result = original.call(this, options);
        if (result && typeof result.then === "function") {
          return result.catch(function (err) {
            if (!isPointerLockError(err)) {
              console.warn(LOG, "lock failed", err);
            }
            keepCursorVisible(800);
            notifyUnity("unlocked");
          });
        }
        return result;
      } catch (err) {
        if (!isPointerLockError(err)) {
          console.warn(LOG, "lock threw", err);
        }
        keepCursorVisible(800);
        notifyUnity("unlocked");
        return Promise.resolve();
      }
    };

    wrapped.__metagraffPointerWrap = true;
    return wrapped;
  }

  function wrapPrototype() {
    var proto = global.HTMLElement && HTMLElement.prototype;
    if (!proto || typeof proto.requestPointerLock !== "function") return;
    proto.requestPointerLock = wrapFunction(proto.requestPointerLock);
  }

  function watchCanvasCursor() {
    var el = getCanvas();
    if (!el || watching) return;
    watching = true;
    var observer = new MutationObserver(function () {
      if (!isLocked()) restoreCursor();
    });
    observer.observe(el, { attributes: true, attributeFilter: ["style"] });
  }

  function attachCanvas() {
    canvas = getCanvas();
    if (canvas && typeof canvas.requestPointerLock === "function") {
      canvas.requestPointerLock = wrapFunction(canvas.requestPointerLock);
    }
    watchCanvasCursor();
    if (!isLocked()) keepCursorVisible(1200);
    updateHint();
  }

  function onEscape() {
    suppress(1200);
    if (document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (err) {}
    }
    keepCursorVisible(1200);
    notifyUnity("unlocked");
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" || event.code === "Escape" || event.keyCode === 27) {
      onEscape();
    }
  }, true);

  document.addEventListener("pointerlockchange", function () {
    if (isLocked()) {
      hideCursor();
      updateHint();
      notifyUnity("locked");
      return;
    }
    suppress(400);
    keepCursorVisible(1200);
    notifyUnity("unlocked");
  });

  document.addEventListener("pointerlockerror", function (event) {
    event.stopImmediatePropagation();
    keepCursorVisible(1200);
    notifyUnity("unlocked");
  }, true);

  global.addEventListener("unhandledrejection", function (event) {
    if (!isPointerLockError(event.reason)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    keepCursorVisible(1200);
    notifyUnity("unlocked");
  }, true);

  wrapPrototype();

  function install() {
    attachCanvas();
    hint = document.getElementById("pointer-hint");
    updateHint();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }

  global.MetaGraffPointer = {
    isLocked: isLocked,
    suppressRelock: suppress,
    restoreCursor: restoreCursor,
    attachCanvas: attachCanvas
  };
})(window);

