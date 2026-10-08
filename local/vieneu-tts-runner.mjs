import {spawn} from 'node:child_process';
import {writeFile, readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runVieNeuTTS({
  lines,
  outputDir,
  voice = 'tinhtri',
  ttsRoot = 'D:/viet tts/VieNeu-TTS',
  pythonExe = 'D:/viet tts/VieNeu-TTS/.venv/Scripts/python.exe',
  signal,
  onProgress
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Danh sách câu thoại (lines) không được rỗng');
  }

  await mkdir(outputDir, {recursive: true});
  const configPath = path.join(outputDir, 'tts-job-config.json');
  await writeFile(configPath, JSON.stringify({
    lines,
    outputDir,
    ttsRoot,
    voice
  }, null, 2), 'utf8');

  const workerScript = path.join(__dirname, 'vieneu-worker.py');

  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [workerScript, '--config-file', configPath], {
      windowsHide: true,
      signal
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString('utf8');
      stdout += text;
      if (onProgress) onProgress(text);
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    child.on('error', (err) => {
      reject(new Error(`Không thể khởi chạy VieNeu-TTS: ${err.message}`));
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`VieNeu-TTS kết thúc với mã lỗi ${code}: ${stderr || stdout}`));
      }

      try {
        const durationsPath = path.join(outputDir, 'durations.json');
        const raw = await readFile(durationsPath, 'utf8');
        const durations = JSON.parse(raw);
        resolve({
          durations,
          totalDuration: Object.values(durations).reduce((a, b) => a + b, 0),
          outputDir
        });
      } catch (err) {
        reject(new Error(`Không đọc được durations.json: ${err.message}`));
      }
    });
  });
}
