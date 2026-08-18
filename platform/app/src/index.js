/**
 * Entry point for development and production PWA builds.
 */
// onnxruntime-web's WebGPU browser bundle (loaded by @cornerstonejs/ai's AI
// auto-segmentation tools, node_modules/@cornerstonejs/ai/dist/esm/
// ONNXSegmentationController.js -> `import ort from 'onnxruntime-web/webgpu'`)
// references the bare identifier `__filename` - a Node.js global with no
// browser equivalent - without guarding it, throwing
// "ReferenceError: __filename is not defined" as soon as that module loads.
// This file is copied to dist/ort raw (CopyWebpackPlugin, see
// platform/app/.webpack/webpack.pwa.js) and loaded outside webpack's own
// module graph, so webpack's usual automatic Node-global shimming never
// applies to it. Defining it as a harmless global before any other code
// runs is the cheapest fix that doesn't require patching node_modules or
// removing the AI segmentation feature.
if (typeof globalThis.__filename === 'undefined') {
  globalThis.__filename = '';
}
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';

/**
 * EXTENSIONS AND MODES
 * =================
 * pluginImports.js is dynamically generated from extension and mode
 * configuration at build time.
 *
 * pluginImports.js imports all of the modes and extensions and adds them
 * to the window for processing.
 */
import { modes as defaultModes, extensions as defaultExtensions } from './pluginImports';
import loadDynamicConfig from './loadDynamicConfig';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';

/**
 * openPopoutWindow() (extensions/default/src/utils/openPopoutWindow.ts)
 * already tries to size a freshly-opened pop-out window to fill the screen
 * from the OPENER's side (window.open() features + moveTo/resizeTo on the
 * returned handle). That's been observed to sometimes get silently ignored
 * by Chrome. As a second, independent attempt at the same goal, a window
 * resizing/moving ITSELF (rather than being resized by another window's
 * reference to it) tends to be honored more reliably - so if this tab is
 * one of our pop-outs (marked via the `_ohifPopout` query param - NOT just
 * "has a window.opener", since that's also true of the unrelated OIDC
 * login popup and the "About OHIF" external-link tab, neither of which
 * should be forced to full screen), do that here too, before React even
 * mounts. Deliberately best-effort and fully defensive: if anything about
 * this throws or isn't supported, it's silently skipped.
 */
try {
  if (window.opener && window.screen && /[?&]_ohifPopout=1(&|$)/.test(window.location.search)) {
    window.moveTo(0, 0);
    window.resizeTo(window.screen.availWidth, window.screen.availHeight);
  }
} catch (e) {
  // Best-effort only - never block app startup over this.
}

loadDynamicConfig(window.config).then(config_json => {
  // Reset Dynamic config if defined
  if (config_json !== null) {
    window.config = config_json;
  }

  /**
   * Combine our appConfiguration with installed extensions and modes.
   * In the future appConfiguration may contain modes added at runtime.
   *  */
  const appProps = {
    config: window ? window.config : {},
    defaultExtensions,
    defaultModes,
  };

  const container = document.getElementById('root');

  const root = createRoot(container);
  root.render(React.createElement(App, appProps));
});
