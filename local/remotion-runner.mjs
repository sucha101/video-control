import {spawn} from 'node:child_process';
import {writeFile, cp, mkdir} from 'node:fs/promises';
import path from 'node:path';

export async function renderStoryVideo({
  jobDir,
  displayId,
  title = 'BÀI HỌC CUỘC SỐNG',
  remotionRoot = 'D:/remotion',
  chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  signal,
  onProgress
}) {
  const publicTarget = path.join(remotionRoot, 'public', 'video-bot', displayId);
  await mkdir(publicTarget, {recursive: true});

  // 1. Đồng bộ assets sang public/video-bot/${displayId}/
  const assetsAudio = path.join(jobDir, 'assets', 'audio');
  const targetAudio = path.join(publicTarget, 'audio');
  await mkdir(targetAudio, {recursive: true});
  await cp(assetsAudio, targetAudio, {recursive: true});

  const durationsSrc = path.join(jobDir, 'durations.json');
  const captionsSrc = path.join(jobDir, 'captions.json');
  await cp(durationsSrc, path.join(publicTarget, 'durations.json'));
  await cp(captionsSrc, path.join(publicTarget, 'captions.json'));

  // Kiểm tra thư mục ảnh scenes
  const scenesSrc = path.join(jobDir, 'assets', 'scenes');
  const scenesTarget = path.join(publicTarget, 'scenes');
  await mkdir(scenesTarget, {recursive: true});
  try {
    await cp(scenesSrc, scenesTarget, {recursive: true});
  } catch {}

  // Đảm bảo có bgm.mp3 trong public audio
  const bgmTarget = path.join(targetAudio, 'bgm.mp3');
  try {
    const bgmFallback = 'D:/remotion/public/video-bot/V011/audio/bgm.mp3';
    await cp(bgmFallback, bgmTarget);
  } catch {}

  // 2. Tạo template Remotion động trong D:/remotion/src/video-bot-runner
  const runnerSrcDir = path.join(remotionRoot, 'src', 'video-bot-runner');
  const componentContent = `import React from 'react';
import type {Caption as RemotionCaption} from '@remotion/captions';
import {Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import durationsRaw from '../../public/video-bot/${displayId}/durations.json';
import captionData from '../../public/video-bot/${displayId}/captions.json';

type SceneCaptions = {scene: number; captions: RemotionCaption[]};
const durations = durationsRaw as Record<string, number>;
const scenes = Object.entries(durations).map(([key, seconds]) => ({
  scene: Number(key),
  seconds,
  audio: 'video-bot/${displayId}/audio/vo_' + String(key).padStart(2, '0') + '.wav'
}));
const captionsByScene = captionData as SceneCaptions[];
const HOLD_FRAMES = 15;
const sceneFrames = scenes.map((scene) => Math.ceil(scene.seconds * 30) + HOLD_FRAMES);
export const TOTAL_FRAMES = sceneFrames.reduce((sum, value) => sum + value, 0);

const Caption: React.FC<{cues: RemotionCaption[]}> = ({cues}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeMs = (frame * 1000) / fps;
  const active = cues.find((cue) => timeMs >= cue.startMs && timeMs < cue.endMs) || cues[cues.length - 1];
  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 260,
        bottom: 480,
        height: 194,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '18px 26px',
        borderRadius: 26,
        background: 'rgba(5, 12, 22, 0.84)',
        border: '1px solid rgba(255, 204, 76, 0.45)',
        color: '#FFD45D',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontSize: 44,
        lineHeight: 1.25,
        fontWeight: 800,
        textShadow: '0 3px 10px rgba(0,0,0,.9)',
        boxShadow: '0 12px 50px rgba(0,0,0,.35)',
        overflow: 'hidden'
      }}
    >
      <span
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
          maxHeight: '2.5em'
        }}
      >
        {active?.text || ''}
      </span>
    </div>
  );
};

const Scene: React.FC<{
  data: {scene: number; seconds: number; audio: string};
  cues: RemotionCaption[];
  index: number;
  frames: number;
}> = ({data, cues, index, frames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = frame / Math.max(1, frames);
  const scale = 1.015 + progress * 0.025;
  const introOpacity = interpolate(frame, [0, 8], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: '#101827', opacity: introOpacity}}>
      <Img
        src={staticFile('video-bot/${displayId}/scenes/scene_' + String(index + 1).padStart(2, '0') + '.png')}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scale(' + scale + ')'
        }}
        onError={(e) => {
          // fallback sang jpg nếu không có png
          const target = e.target as HTMLImageElement;
          if (target.src.endsWith('.png')) {
            target.src = target.src.replace('.png', '.jpg');
          }
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(6,13,24,.55) 0%, rgba(6,13,24,0) 30%, rgba(6,13,24,.10) 55%, rgba(6,13,24,.82) 100%)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 132,
          left: 72,
          right: 260,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#fff',
          fontFamily: 'Segoe UI, Arial, sans-serif',
          textShadow: '0 2px 8px #000',
          fontWeight: 700
        }}
      >
        <span style={{fontSize: 28, letterSpacing: 2, color: '#FFD45D'}}>${title.slice(0, 30).toUpperCase()}</span>
        <span style={{fontSize: 24, opacity: 0.9}}>{String(index + 1).padStart(2, '0')} / {scenes.length}</span>
      </div>
      <Caption cues={cues} />
      <Audio src={staticFile(data.audio)} volume={1} />
    </div>
  );
};

export const AutoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  let start = 0;
  const entries = scenes.map((data, index) => {
    const from = start;
    const duration = sceneFrames[index];
    start += duration;
    return (
      <Sequence key={data.scene} from={from} durationInFrames={duration}>
        <Scene data={data} cues={captionsByScene[index]?.captions || []} index={index} frames={duration} />
      </Sequence>
    );
  });

  const musicVolume = (f: number) =>
    interpolate(f, [0, 45, TOTAL_FRAMES - 90, TOTAL_FRAMES], [0, 0.12, 0.12, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });

  return (
    <div style={{width: '100%', height: '100%', background: '#101827'}}>
      {entries}
      <Audio src={staticFile('video-bot/${displayId}/audio/bgm.mp3')} loop volume={musicVolume(frame)} />
    </div>
  );
};
`;

  const indexContent = `import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {AutoVideo, TOTAL_FRAMES} from './AutoVideo';

const Root: React.FC = () => (
  <Composition
    id="AutoVideo"
    component={AutoVideo}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1080}
    height={1920}
  />
);

registerRoot(Root);
`;

  await writeFile(path.join(runnerSrcDir, 'AutoVideo.tsx'), componentContent, 'utf8');
  await writeFile(path.join(runnerSrcDir, 'index.tsx'), indexContent, 'utf8');

  // 3. Render MP4 bằng npx remotion render
  const outputMp4 = path.join(jobDir, `${displayId}.mp4`);
  const renderArgs = [
    'remotion', 'render',
    'src/video-bot-runner/index.tsx',
    'AutoVideo',
    outputMp4,
    `--browser-executable=${chromePath}`,
    '--browser-timeout=120000',
    '--concurrency=1'
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('npx.cmd', renderArgs, {
      cwd: remotionRoot,
      windowsHide: true,
      signal
    });

    let stderr = '';
    child.stdout?.on('data', (d) => {
      const text = d.toString('utf8');
      if (onProgress) onProgress(text);
    });

    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (err) => reject(new Error(`Không thể khởi chạy Remotion: ${err.message}`)));

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Remotion render thất bại (code ${code}): ${stderr}`));
      }
      resolve({videoPath: outputMp4, displayId});
    });
  });
}
