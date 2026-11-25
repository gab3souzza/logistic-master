import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const api = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
const web = spawn(npmBin, ['--host', '0.0.0.0'], { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });

function stop() { api.kill('SIGTERM'); web.kill('SIGTERM'); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => { if (code && code !== 0) { console.error(`API encerrou com código ${code}`); stop(); process.exitCode = code; } });
web.on('exit', (code) => { if (code && code !== 0) { console.error(`Vite encerrou com código ${code}`); stop(); process.exitCode = code; } });
