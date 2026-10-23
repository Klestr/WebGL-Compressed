(function (global) {
  var LOG = "[GalleryPointer]";
  var suppressUntil = 0;
  var canvas = null;
  var hint = null;

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

  function restoreCursor() {
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
    hint.hidden = !!document.pointerLockElement;
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
      if (now() < suppressUntil || document.pointerLockElement) {
        restoreCursor();
        updateHint();
        return Promise.resolve();
      }

      try {
        var result = original.call(this, options);
        if (result && typeof result.then === "function") {
          return result.catch(function (err) {
            if (!isPointerLockError(err)) {
              console.warn(LOG, "lock failed", err);
            }
            restoreCursor();
            updateHint();
            notifyUnity("unlocked");
          });
        }
        return result;
      } catch (err) {
        if (!isPointerLockError(err)) {
          console.warn(LOG, "lock threw", err);
        }
        restoreCursor();
        updateHint();
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

  function attachCanvas() {
    canvas = getCanvas();
    if (!canvas || typeof canvas.requestPointerLock !== "function") return;
    canvas.requestPointerLock = wrapFunction(canvas.requestPointerLock);
    updateHint();
  }

  function onEscape() {
    suppress(1200);
    if (document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (err) {}
    }
    restoreCursor();
    updateHint();
    notifyUnity("unlocked");
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" || event.code === "Escape" || event.keyCode === 27) {
      onEscape();
    }
  }, true);

  document.addEventListener("pointerlockchange", function () {
    if (document.pointerLockElement) {
      hideCursor();
      updateHint();
      notifyUnity("locked");
      return;
    }
    suppress(400);
    restoreCursor();
    updateHint();
    notifyUnity("unlocked");
  });

  document.addEventListener("pointerlockerror", function (event) {
    event.stopImmediatePropagation();
    restoreCursor();
    updateHint();
    notifyUnity("unlocked");
  }, true);

  global.addEventListener("unhandledrejection", function (event) {
    if (!isPointerLockError(event.reason)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    restoreCursor();
    updateHint();
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
    isLocked: function () {
      return !!document.pointerLockElement;
    },
    suppressRelock: suppress,
    restoreCursor: restoreCursor,
    attachCanvas: attachCanvas
  };
})(window);
