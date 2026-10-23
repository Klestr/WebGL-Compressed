(function (global) {
  var LOG = "[GalleryWallet]";
  var unityGameObject = "GalleryWalletBridge";
  var unityInstance = null;
  var eagerAttempted = false;
  var hostUiOpen = false;
  var connected = {
    walletName: "",
    publicKey: ""
  };

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

  function getPhantom() {
    var provider = global.phantom && global.phantom.solana;
    if (provider && provider.isPhantom) return provider;
    return null;
  }

  function getSolflare() {
    var provider = global.solflare;
    if (provider && provider.isSolflare) return provider;
    return null;
  }

  function getProvider(walletName) {
    if (walletName === "phantom") return getPhantom();
    if (walletName === "solflare") return getSolflare();
    return null;
  }

  function publicKeyToString(publicKey) {
    if (!publicKey) return "";
    if (typeof publicKey === "string") return publicKey;
    if (typeof publicKey.toBase58 === "function") return publicKey.toBase58();
    if (typeof publicKey.toString === "function") return publicKey.toString();
    return String(publicKey);
  }

  function sendToUnity(method, payload) {
    var instance = unityInstance || global.unityInstance;
    if (!instance || typeof instance.SendMessage !== "function") {
      log("Unity instance not ready; skipped", method);
      return;
    }
    instance.SendMessage(unityGameObject, method, payload == null ? "" : String(payload));
  }

  function notifyPointerDown() {
    if (global.MetaGraffPointer && typeof global.MetaGraffPointer.suppressRelock === "function") {
      global.MetaGraffPointer.suppressRelock(1200);
      if (typeof global.MetaGraffPointer.restoreCursor === "function") {
        global.MetaGraffPointer.restoreCursor();
      }
    }
    if (global.document && typeof global.document.exitPointerLock === "function") {
      global.document.exitPointerLock();
    }
    sendToUnity("OnWalletUiPointerDown", "");
  }

  function truncate(publicKey) {
    if (!publicKey || publicKey.length < 10) return publicKey || "";
    return publicKey.slice(0, 4) + "…" + publicKey.slice(-4);
  }

  function updateOverlay() {
    var label = document.getElementById("wallet-chip-label");
    var disconnectButton = document.getElementById("wallet-disconnect");
    if (label) {
      label.textContent = connected.publicKey
        ? connected.walletName + " · " + truncate(connected.publicKey)
        : "Connect wallet";
    }
    if (disconnectButton) disconnectButton.hidden = !connected.publicKey;
  }

  function setConnected(walletName, publicKey) {
    connected.walletName = walletName;
    connected.publicKey = publicKey;
    log("Connected", walletName, publicKey);
    sendToUnity("OnWalletConnected", JSON.stringify({
      walletName: walletName,
      publicKey: publicKey
    }));
    updateOverlay();
    if (!hostUiOpen && global.MetaGraffApi && typeof global.MetaGraffApi.fetchNonce === "function") {
      global.MetaGraffApi.fetchNonce(publicKey);
    }
  }

  function setDisconnected(reason) {
    var previous = connected.publicKey;
    connected.walletName = "";
    connected.publicKey = "";
    if (previous) log("Disconnected", reason || "");
    sendToUnity("OnWalletDisconnected", reason || "");
    updateOverlay();
    if (global.MetaGraffApi && typeof global.MetaGraffApi.clearAuth === "function") {
      global.MetaGraffApi.clearAuth();
    }
  }

  var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function bytesToBase58(bytes) {
    if (!bytes || !bytes.length) return "";
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
    var out = "";
    for (var z = 0; z < zeros; z++) out += "1";
    for (var k = digits.length - 1; k >= 0; k--) out += BASE58_ALPHABET[digits[k]];
    return out;
  }

  function encodeUtf8(text) {
    if (global.TextEncoder) return new TextEncoder().encode(String(text));
    var encoded = unescape(encodeURIComponent(String(text)));
    var bytes = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
    return bytes;
  }

  function toUint8Array(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (typeof value === "string") return null;
    if (Array.isArray(value)) return new Uint8Array(value);
    if (value.type === "Buffer" && Array.isArray(value.data)) return new Uint8Array(value.data);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value.signature) return toUint8Array(value.signature);
    return null;
  }

  function signMessage(message) {
    var walletName = connected.walletName;
    var provider = getProvider(walletName);
    if (!provider) {
      return Promise.reject(new Error("Connect a wallet before signing"));
    }
    if (typeof provider.signMessage !== "function") {
      return Promise.reject(new Error(walletName + " does not support signMessage"));
    }

    notifyPointerDown();
    var bytes = encodeUtf8(message);
    log("Requesting signMessage", walletName);

    return Promise.resolve(provider.signMessage(bytes, "utf8")).then(function (result) {
      if (typeof result === "string" && result.length) return result;
      var signatureBytes = toUint8Array(result);
      if (!signatureBytes || !signatureBytes.length) {
        throw new Error("Wallet returned an empty signature");
      }
      return bytesToBase58(signatureBytes);
    });
  }

  function listenProvider(walletName, provider) {
    if (!provider || provider.__metagraffBound || typeof provider.on !== "function") return;
    provider.__metagraffBound = true;

    provider.on("disconnect", function () {
      if (connected.walletName === walletName) setDisconnected("provider");
    });

    provider.on("accountChanged", function (publicKey) {
      if (connected.walletName !== walletName) return;
      var next = publicKeyToString(publicKey);
      if (next) {
        log("Account changed", walletName, next);
        setConnected(walletName, next);
      } else {
        setDisconnected("accountChanged");
      }
    });
  }

  function connect(walletName) {
    var provider = getProvider(walletName);
    if (!provider) {
      var url = walletName === "solflare" ? "https://solflare.com" : "https://phantom.app/";
      warn(walletName, "is not installed");
      sendToUnity("OnWalletError", walletName + " is not installed");
      global.open(url, "_blank");
      return Promise.reject(new Error(walletName + " is not installed"));
    }

    notifyPointerDown();

    var connectPromise = provider.connect();
    return Promise.resolve(connectPromise).then(function (response) {
      var publicKey = publicKeyToString(
        (response && response.publicKey) || provider.publicKey
      );
      if (!publicKey) throw new Error("Wallet connected without a public key");
      listenProvider(walletName, provider);
      setConnected(walletName, publicKey);
    }).catch(function (err) {
      var message = err && (err.message || err.code)
        ? String(err.message || err.code)
        : String(err);
      warn("Connect failed", walletName, message);
      sendToUnity("OnWalletError", message);
    });
  }

  function disconnect() {
    var walletName = connected.walletName;
    var provider = getProvider(walletName);
    var done = (provider && typeof provider.disconnect === "function")
      ? Promise.resolve(provider.disconnect())
      : Promise.resolve();

    return done.catch(function (err) {
      warn("Disconnect error", err);
    }).then(function () {
      setDisconnected("user");
    });
  }

  function tryEagerConnect() {
    if (eagerAttempted) return Promise.resolve();
    eagerAttempted = true;

    var phantom = getPhantom();
    if (phantom) {
      return Promise.resolve(phantom.connect({ onlyIfTrusted: true })).then(function (response) {
        var publicKey = publicKeyToString(
          (response && response.publicKey) || phantom.publicKey
        );
        if (!publicKey) return;
        listenProvider("phantom", phantom);
        setConnected("phantom", publicKey);
      }).catch(function () {
        var solflare = getSolflare();
        if (solflare && solflare.isConnected && solflare.publicKey) {
          listenProvider("solflare", solflare);
          setConnected("solflare", publicKeyToString(solflare.publicKey));
        }
      });
    }

    var solflare = getSolflare();
    if (solflare && solflare.isConnected && solflare.publicKey) {
      listenProvider("solflare", solflare);
      setConnected("solflare", publicKeyToString(solflare.publicKey));
    }
    return Promise.resolve();
  }

  function bindOverlay() {
    var root = document.getElementById("wallet-overlay");
    if (!root) return;

    root.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
      notifyPointerDown();
    });

    var chip = document.getElementById("wallet-chip");
    var panel = document.getElementById("wallet-panel");
    if (chip && panel) {
      chip.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
      });
    }

    var phantomButton = document.getElementById("wallet-connect-phantom");
    if (phantomButton) {
      phantomButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        connect("phantom");
      });
    }

    var solflareButton = document.getElementById("wallet-connect-solflare");
    if (solflareButton) {
      solflareButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        connect("solflare");
      });
    }

    var disconnectButton = document.getElementById("wallet-disconnect");
    if (disconnectButton) {
      disconnectButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        disconnect();
      });
    }

    updateOverlay();
  }

  function setModalStatus(text) {
    var status = document.getElementById("wallet-signin-status");
    if (status) status.textContent = text;
  }

  function setSignInButtonsDisabled(disabled) {
    var ids = ["wallet-signin-phantom", "wallet-signin-solflare", "wallet-signin-cancel"];
    for (var i = 0; i < ids.length; i++) {
      var button = document.getElementById(ids[i]);
      if (button) button.disabled = !!disabled;
    }
  }

  function exitCanvasFullscreen() {
    try {
      var instance = unityInstance || global.unityInstance;
      if (instance && typeof instance.SetFullscreen === "function") {
        instance.SetFullscreen(0);
      }
    } catch (err) {}
    var doc = global.document;
    if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
      doc.exitFullscreen();
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === "function") {
      doc.webkitExitFullscreen();
    }
  }

  function setHostUiOpen(open) {
    hostUiOpen = !!open;
    var modal = document.getElementById("wallet-signin-modal");
    if (modal) modal.hidden = !hostUiOpen;
    notifyPointerDown();
    sendToUnity(hostUiOpen ? "OnHostUiOpened" : "OnHostUiClosed", "");
    if (!hostUiOpen) {
      setSignInButtonsDisabled(false);
      setModalStatus("Choose Phantom or Solflare. After you approve, you return to the gallery.");
    }
  }

  function currentAuthPayload() {
    var token = "";
    var expiresIn = 0;
    if (global.MetaGraffApi) {
      if (typeof global.MetaGraffApi.getAuthToken === "function") {
        token = global.MetaGraffApi.getAuthToken() || "";
      }
      if (typeof global.MetaGraffApi.getLastAuth === "function") {
        var auth = global.MetaGraffApi.getLastAuth();
        if (auth && auth.expiresIn) expiresIn = auth.expiresIn;
        if (!token && auth && auth.token) token = auth.token;
      }
    }
    return {
      walletName: connected.walletName || "",
      publicKey: connected.publicKey || "",
      token: token,
      expiresIn: expiresIn
    };
  }

  function notifyAuthSignedIn() {
    var payload = currentAuthPayload();
    if (!payload.publicKey || !payload.token) return false;
    sendToUnity("OnAuthSignedIn", JSON.stringify(payload));
    return true;
  }

  function requestSignIn() {
    log("Sign in requested from Unity");
    if (notifyAuthSignedIn()) return;

    exitCanvasFullscreen();
    setHostUiOpen(true);
    setModalStatus("Choose Phantom or Solflare. After you approve, you return to the gallery.");
  }

  function cancelSignIn() {
    setHostUiOpen(false);
    sendToUnity("OnAuthCancelled", "cancelled");
  }

  function signOut() {
    setHostUiOpen(false);
    disconnect();
    sendToUnity("OnAuthSignedOut", "");
  }

  function signInWith(walletName) {
    setSignInButtonsDisabled(true);
    setModalStatus("Connecting " + walletName + "…");
    notifyPointerDown();

    return Promise.resolve(connect(walletName)).then(function () {
      if (!connected.publicKey) throw new Error("Wallet did not connect");
      if (!global.MetaGraffApi || typeof global.MetaGraffApi.connectWithWallet !== "function") {
        throw new Error("Auth overlay is missing. Hard-refresh the page.");
      }
      setModalStatus("Approve the sign-in message in " + walletName + "…");
      return global.MetaGraffApi.connectWithWallet();
    }).then(function (auth) {
      if (!auth || !auth.token) throw new Error("Sign in did not return a token");
      log("Signed in", connected.publicKey);
      notifyAuthSignedIn();
      setHostUiOpen(false);
    }).catch(function (err) {
      var message = err && (err.message || err.code)
        ? String(err.message || err.code)
        : String(err);
      if (err && (err.code === 4001 || err.code === "4001")) {
        message = "Sign in cancelled";
      }
      warn("In-experience sign in failed", message);
      setSignInButtonsDisabled(false);
      setModalStatus(message + " Try again, or Cancel to return to the gallery.");
      sendToUnity("OnAuthError", message);
    });
  }

  function bindSignInModal() {
    var modal = document.getElementById("wallet-signin-modal");
    if (!modal) return;

    modal.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
      notifyPointerDown();
    });

    var phantomButton = document.getElementById("wallet-signin-phantom");
    if (phantomButton) {
      phantomButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        signInWith("phantom");
      });
    }

    var solflareButton = document.getElementById("wallet-signin-solflare");
    if (solflareButton) {
      solflareButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        signInWith("solflare");
      });
    }

    var cancelButton = document.getElementById("wallet-signin-cancel");
    if (cancelButton) {
      cancelButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        cancelSignIn();
      });
    }
  }

  global.MetaGraffWallet = {
    setUnityInstance: function (instance) {
      unityInstance = instance;
      global.unityInstance = instance;
      log("Unity instance registered");
      if (unityGameObject) tryEagerConnect();
    },
    registerGameObject: function (name) {
      if (name) unityGameObject = name;
      log("Unity game object registered", unityGameObject);
      if (unityInstance || global.unityInstance) tryEagerConnect();
    },
    getPublicKey: function () {
      return connected.publicKey || "";
    },
    getWalletName: function () {
      return connected.walletName || "";
    },
    connect: connect,
    disconnect: disconnect,
    signMessage: signMessage,
    requestSignIn: requestSignIn,
    signInWith: signInWith,
    signOut: signOut,
    cancelSignIn: cancelSignIn
  };

  function bindAll() {
    bindOverlay();
    bindSignInModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAll);
  } else {
    bindAll();
  }
})(window);
