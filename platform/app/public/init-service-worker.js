// Service workers require a secure context (HTTPS or localhost).
// On plain HTTP over a LAN IP (e.g. http://192.168.x.x) the browser sets
// navigator.serviceWorker to undefined. Guard every call so the viewer
// still works over HTTP in hospital intranet deployments.

if ('serviceWorker' in navigator) {
  // Unregister any previously cached service workers so stale assets
  // don't interfere after a production rebuild.
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    for (let registration of registrations) {
      registration.unregister();
    }
  });
}

// https://developers.google.com/web/tools/workbox/modules/workbox-window
// All major browsers that support service worker also support native JavaScript
// modules, so it's perfectly fine to serve this code to any browsers
// (older browsers will just ignore it)
//
//import { Workbox } from './workbox-window.prod.mjs';
// proper initialization
if ('function' === typeof importScripts) {
  importScripts(
    'https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-window.prod.mjs'
  );

  var supportsServiceWorker = 'serviceWorker' in navigator;
  var isNotLocalDevelopment = ['localhost', '127'].indexOf(location.hostname) === -1;

  if (supportsServiceWorker && isNotLocalDevelopment) {
    const swFileLocation = (window.PUBLIC_URL || '/') + 'sw.js';
    const wb = new Workbox(swFileLocation);

    wb.addEventListener('waiting', event => {
      wb.addEventListener('controlling', event => {
        window.location.reload();
      });
      wb.messageSW({ type: 'SKIP_WAITING' });
    });

    wb.register();
  }
}
