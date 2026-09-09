import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const vinextCli = resolve('node_modules/vinext/dist/cli.js');
const build = spawn(process.execPath, [vinextCli, 'build'], {
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

let recentOutput = '';
const remember = (chunk) => {
  recentOutput = `${recentOutput}${chunk.toString()}`.slice(-50_000);
};

build.stdout.on('data', (chunk) => {
  remember(chunk);
  process.stdout.write(chunk);
});

build.stderr.on('data', (chunk) => {
  remember(chunk);
  process.stderr.write(chunk);
});

build.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

build.on('close', (code) => {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  const isKnownWindowsShutdownCrash =
    process.platform === 'win32' &&
    nodeMajor >= 24 &&
    recentOutput.includes('Build complete.') &&
    recentOutput.includes(
      'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)',
    );

  if (code !== 0 && isKnownWindowsShutdownCrash) {
    console.warn(
      '[build] Vinext completed successfully; ignored its Node 24 Windows shutdown assertion.',
    );
    process.exitCode = 0;
    return;
  }

  process.exitCode = code ?? 1;
});
