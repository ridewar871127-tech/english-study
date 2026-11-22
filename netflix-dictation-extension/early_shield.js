(function () {
  "use strict";

  if (window.__ND_EARLY_SHIELD__) return;
  window.__ND_EARLY_SHIELD__ = true;

  let studioFocusLocked = false;

  function getHost() {
    return document.getElementById("nd-studio-host");
  }

  function isPathInsideStudio(event) {
    if (event && typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node && node.id === "nd-studio-host") return true;
      }
    }
    const active = document.activeElement;
    return Boolean(active && active.id === "nd-studio-host");
  }

  function syncFocusLockToMain(locked) {
    studioFocusLocked = locked;
    window.postMessage({ source: "ND_UI", type: "SET_FOCUS_LOCK", locked }, "*");
  }

  // Track mouse/pointer clicks inside vs outside #nd-studio-host
  ["pointerdown", "mousedown"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        const inside = isPathInsideStudio(e);
        syncFocusLockToMain(inside);
      },
      true
    );
  });

  // Listener #0 on window (capture phase, document_start, ISOLATED world):
  // Runs BEFORE all Netflix page listeners on window/document/React roots!
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

        // Escape releases focus lock intentionally
        if (evtType === "keydown" && e.key === "Escape") {
          syncFocusLockToMain(false);
          if (innerActive && typeof innerActive.blur === "function") {
            innerActive.blur();
          }
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }

        // If user clicked inside studio panel background/button and starts typing or presses Space,
        // move focus directly into #dictInput so Space never activates a button or blurs!
        if (
          evtType === "keydown" &&
          shadow &&
          (!innerActive || (innerActive.tagName !== "TEXTAREA" && innerActive.tagName !== "INPUT"))
        ) {
          const dictInput = shadow.getElementById("dictInput");
          if (dictInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
            dictInput.focus();
          }
        }

        if (evtType === "keydown") {
          if (e.ctrlKey && e.code === "Space") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("nd-studio-shortcut", { detail: { command: "REPLAY" } }));
            return;
          }
          if (e.altKey && e.code === "KeyH") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent("nd-studio-shortcut", { detail: { command: "HINT_FIRST" } }));
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            const currentInner = shadow && shadow.activeElement;
            if (!currentInner || currentInner.id === "dictInput") {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              document.dispatchEvent(new CustomEvent("nd-studio-shortcut", { detail: { command: "ENTER" } }));
              return;
            }
          }
        }

        // Do NOT call preventDefault() for Space or letters so native typing in <textarea> works 100%,
        // while blocking Netflix's Space/F/M/S/Arrow global listeners completely!
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true
    );
  });

  // Block focusin / focusout from reaching Netflix's React FocusTrap on document!
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
