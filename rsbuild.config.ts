import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import path from 'path';
import writePluginImportsFile from './platform/app/.webpack/writePluginImportsFile';
import fs from 'fs';

const SRC_DIR = path.resolve(__dirname, './platform/app/src');
const DIST_DIR = path.resolve(__dirname, './platform/app/dist');
const PUBLIC_DIR = path.resolve(__dirname, './platform/app/public');

// Environment variables (similar to webpack.pwa.js)
// Default to our custom app-config.js (SKM PACS endpoints).
// The original OHIF default was 'config/default.js' which points to the OHIF
// demo CloudFront server — never use that in production.
const APP_CONFIG = process.env.APP_CONFIG || 'app-config.js';
const PUBLIC_URL = process.env.PUBLIC_URL || '/';

// Add these constants
const NODE_ENV = process.env.NODE_ENV;
const BUILD_NUM = process.env.CIRCLE_BUILD_NUM || '0';
const VERSION_NUMBER = fs.readFileSync(path.join(__dirname, './version.txt'), 'utf8') || '';
const COMMIT_HASH = fs.readFileSync(path.join(__dirname, './commit.txt'), 'utf8') || '';
const PROXY_TARGET = process.env.PROXY_TARGET;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const PROXY_PATH_REWRITE_FROM = process.env.PROXY_PATH_REWRITE_FROM;
const PROXY_PATH_REWRITE_TO = process.env.PROXY_PATH_REWRITE_TO;

// Add port constant
const OHIF_PORT = Number(process.env.OHIF_PORT || 3000);
const OHIF_OPEN = process.env.OHIF_OPEN !== 'false';

// Ignore node_modules except @cornerstonejs (symlinked local development).
const WATCH_IGNORED = /node_modules[\\/](?!@cornerstonejs(?:[\\/]|$))/;

export default defineConfig({
  dev: {
    lazyCompilation: false,
  },
  source: {
    entry: {
      index: `${SRC_DIR}/index.js`,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
      'process.env.DEBUG': JSON.stringify(process.env.DEBUG),
      'process.env.PUBLIC_URL': JSON.stringify(process.env.PUBLIC_URL || '/'),
      'process.env.BUILD_NUM': JSON.stringify(BUILD_NUM),
      'process.env.VERSION_NUMBER': JSON.stringify(VERSION_NUMBER),
      'process.env.COMMIT_HASH': JSON.stringify(COMMIT_HASH),
      'process.env.USE_LOCIZE': JSON.stringify(process.env.USE_LOCIZE || ''),
      'process.env.LOCIZE_PROJECTID': JSON.stringify(process.env.LOCIZE_PROJECTID || ''),
      'process.env.LOCIZE_API_KEY': JSON.stringify(process.env.LOCIZE_API_KEY || ''),
      'process.env.REACT_APP_I18N_DEBUG': JSON.stringify(process.env.REACT_APP_I18N_DEBUG || ''),
    },
  },
  plugins: [pluginReact(), pluginNodePolyfill()],
  tools: {
    rspack: {
      experiments: {
        asyncWebAssembly: true,
      },
      module: {
        rules: [
          {
            test: /\.css$/,
            use: [
              {
                loader: 'postcss-loader',
                options: {
                  postcssOptions: {
                    // Use array format with explicit config path so Tailwind can
                    // find its config whether rsbuild runs from the root (build)
                    // or from platform/app (dev:fast). The object shorthand
                    // silently fails in production builds when CWD != platform/app.
                    plugins: [
                      // Pass the ABSOLUTE PATH to the config file (not the object).
                      // When given a path, Tailwind sets the config file's directory
                      // as the base for resolving relative `content:` globs, so
                      // './src/**' correctly maps to platform/app/src/**,
                      // '../../extensions/**' maps to extensions/**, etc.
                      // Passing the config object instead causes all relative paths
                      // to resolve from CWD (monorepo root), scanning nothing and
                      // purging all viewer-layout CSS in production builds.
                      require('tailwindcss')(
                        path.resolve(__dirname, './platform/app/tailwind.config.js')
                      ),
                      require('autoprefixer'),
                    ],
                  },
                },
              },
            ],
            type: 'javascript/auto',
          },
          {
            test: /\.wasm$/,
            type: 'asset/resource',
          },
        ],
      },
      resolve: {
        fallback: {
          buffer: require.resolve('buffer'),
        },
      },
      watchOptions: {
        ignored: WATCH_IGNORED,
        followSymlinks: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './platform/app/src'),
      '@components': path.resolve(__dirname, './platform/app/src/components'),
      '@hooks': path.resolve(__dirname, './platform/app/src/hooks'),
      '@routes': path.resolve(__dirname, './platform/app/src/routes'),
      '@state': path.resolve(__dirname, './platform/app/src/state'),
    },
  },
  output: {
    // Direct all rsbuild output (JS, CSS, HTML) into the same folder that
    // the copy tasks below and Nginx point to.
    distPath: {
      root: './platform/app/dist',
    },
    copy: [
      // Copy plugin files (handled by writePluginImportsFile)
      ...(writePluginImportsFile(SRC_DIR, DIST_DIR) || []),
      // Copy public directory except config and html-templates
      {
        from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
        to: `${DIST_DIR}/ort`,
        force: true,
      },
      {
        from: PUBLIC_DIR,
        to: DIST_DIR,
        globOptions: {
          ignore: ['**/config/**', '**/html-templates/**', '.DS_Store'],
        },
      },
      // Copy Google config
      {
        from: path.resolve(PUBLIC_DIR, 'config/google.js'),
        to: 'google.js',
      },
      // Copy app config
      {
        from: path.resolve(PUBLIC_DIR, APP_CONFIG),
        to: 'app-config.js',
      },
    ],
  },
  html: {
    template: path.resolve(PUBLIC_DIR, 'html-templates/index.html'),
    templateParameters: {
      PUBLIC_URL,
      // Read the SKM PACS config file and inline it directly into index.html.
      // This guarantees window.config is set before OHIF boots, in BOTH dev
      // mode (where output.copy does not run) and production builds.
      // Changing app-config.js requires a dev server restart (acceptable —
      // WADO endpoint URLs don't change during normal development).
      APP_CONFIG_SCRIPT_TAG: `<script type="text/javascript">${fs.readFileSync(
        path.resolve(PUBLIC_DIR, 'app-config.js'),
        'utf8'
      )}</script>`,
    },
  },
  server: {
    port: OHIF_PORT,
    open: OHIF_OPEN,
    // Serve platform/app/public/ as static files in dev mode.
    // Without this, rsbuild looks for a `public/` dir next to rsbuild.config.ts
    // (the monorepo root) which does not exist, so app-config.js returns 404
    // and OHIF falls back to its built-in demo CloudFront data source.
    publicDir: {
      name: PUBLIC_DIR,
    },
    // Configure proxy
    proxy: {
      '/dicomweb': {
        target: 'http://localhost:5000',
      },
      // Add conditional proxy based on env vars
      ...(PROXY_TARGET && PROXY_DOMAIN
        ? {
            [PROXY_TARGET]: {
              target: PROXY_DOMAIN,
              changeOrigin: true,
              pathRewrite: {
                [`^${PROXY_PATH_REWRITE_FROM}`]: PROXY_PATH_REWRITE_TO,
              },
            },
          }
        : {}),
    },
    // Configure history API fallback
    historyApiFallback: {
      disableDotRule: true,
      index: `${PUBLIC_URL}index.html`,
    },
  },
});
