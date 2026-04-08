const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Extension bundle — runs in Node.js inside VS Code
  const extensionCtx = await esbuild.context({
    entryPoints: { 'extension': 'src/extension.ts' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    outdir: 'dist',
    external: ['vscode'],
    logLevel: 'info',
  });

  // Webview bundle — runs in a Chromium-based browser/webview context
  const webviewCtx = await esbuild.context({
    entryPoints: { 'webview/main': 'src/webview/main.js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    outdir: 'dist',
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"'
    }
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
