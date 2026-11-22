(function () {
  "use strict";

  if (window.__NJD_EARLY_SHIELD__) return;
  window.__NJD_EARLY_SHIELD__ = true;

  let studioFocusLocked = false;

  function getHost() {
    return document.getElementById("njd-studio-host");
  }

  function isPathInsideStudio(event) {
    if (event && typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node && node.id === "njd-studio-host") return true;
      }
    }
    const active = document.activeElement;
    return Boolean(active && active.id === "njd-studio-host");
  }

  function syncFocusLockToMain(locked) {
    studioFocusLocked = locked;
    window.postMessage({ source: "NJD_UI", type: "SET_FOCUS_LOCK", locked }, "*");
  }

  ["pointerdown", "mousedown"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        syncFocusLockToMain(isPathInsideStudio(e));
      },
      true
    );
  });

  ["keydown", "keypress", "keyup"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        if (!studioFocusLocked && !isPathInsideStudio(e)) {
          return;
        }

        const host = getHost();
        const shadow = host && host.shadowRoot;
        const innerActive = shadow && shadow.activeElement;
        const isTypingInInput =
          innerActive && (innerActive.tagName === "INPUT" || innerActive.tagName === "TEXTAREA");

        if (evtType === "keydown" && e.key === "Escape") {
          syncFocusLockToMain(false);
          if (innerActive && typeof innerActive.blur === "function") innerActive.blur();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }

        // Allow normal typing, Backspace, Ctrl+V paste, and digits inside all <input> boxes while blocking Netflix hotkeys
        if (isTypingInInput) {
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }

        if (evtType === "keydown") {
          if (e.ctrlKey && e.code === "Space") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("njd-studio-shortcut", { detail: { command: "REPLAY" } }));
            return;
          }
          if (e.altKey && e.code === "KeyH") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("njd-studio-shortcut", { detail: { command: "HINT_NEXT" } }));
            return;
          }
          if (e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("njd-studio-shortcut", { detail: { command: "UNDO_LAST" } }));
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("njd-studio-shortcut", { detail: { command: "ENTER" } }));
            return;
          }
          if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(
              new CustomEvent("njd-studio-shortcut", {
                detail: { command: "PICK_NUM", index: parseInt(e.key, 10) - 1 }
              })
            );
            return;
          }
        }

        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true
    );
  });

  ["focusin", "focusout"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        if (studioFocusLocked || isPathInsideStudio(e)) {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  });
})();
