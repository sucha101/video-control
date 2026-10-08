import {spawn} from 'node:child_process';
import {writeFile, cp, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

/**
 * Render Video dạng Story tâm sự / triết lý / moral (viet-tiktok-story-video)
 */
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
  const targetAudio = path.join(publicTarget, 'audio');
  await mkdir(targetAudio, {recursive: true});
  const assetsAudioVo = path.join(jobDir, 'assets', 'audio', 'vo');
  try {
    await cp(assetsAudioVo, targetAudio, {recursive: true});
  } catch {
    const assetsAudio = path.join(jobDir, 'assets', 'audio');
    await cp(assetsAudio, targetAudio, {recursive: true});
  }

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
  await mkdir(runnerSrcDir, {recursive: true});

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

  return runRemotionRender({
    compositionId: 'AutoVideo',
    entryPath: 'src/video-bot-runner/index.tsx',
    outputMp4: path.join(jobDir, `${displayId}.mp4`),
    displayId,
    remotionRoot,
    chromePath,
    signal,
    onProgress
  });
}

/**
 * Render Video Phóng Sự Drama Mascot chuẩn SOP (drama-mascot-video)
 * Tích hợp: Mascot biểu cảm, Glass Evidence Card, Backdrop Blur, Headline Callout, TikTok Safe-Zone Subtitles, SFX Boom, News Pulse BGM
 */
export async function renderDramaMascotVideo({
  jobDir,
  displayId,
  title = 'TIN NÓNG DRAMA',
  scenePlan = null,
  remotionRoot = 'D:/remotion',
  chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  signal,
  onProgress
}) {
  const publicTarget = path.join(remotionRoot, 'public', 'video-bot', displayId);
  await mkdir(publicTarget, {recursive: true});

  // 1. Đồng bộ VO
  const targetAudio = path.join(publicTarget, 'audio');
  await mkdir(targetAudio, {recursive: true});
  const assetsAudioVo = path.join(jobDir, 'assets', 'audio', 'vo');
  try {
    await cp(assetsAudioVo, targetAudio, {recursive: true});
  } catch {
    const assetsAudio = path.join(jobDir, 'assets', 'audio');
    await cp(assetsAudio, targetAudio, {recursive: true});
  }

  const durationsSrc = path.join(jobDir, 'durations.json');
  const captionsSrc = path.join(jobDir, 'captions.json');
  await cp(durationsSrc, path.join(publicTarget, 'durations.json'));
  await cp(captionsSrc, path.join(publicTarget, 'captions.json'));

  // Đồng bộ scenes
  const scenesSrc = path.join(jobDir, 'assets', 'scenes');
  const scenesTarget = path.join(publicTarget, 'scenes');
  await mkdir(scenesTarget, {recursive: true});
  try {
    await cp(scenesSrc, scenesTarget, {recursive: true});
  } catch {}

  // 2. Đọc durations & chuẩn bị metadata drama từng cảnh
  const durationsRaw = JSON.parse(await readFile(durationsSrc, 'utf8'));
  const sceneKeys = Object.keys(durationsRaw).map(Number).sort((a, b) => a - b);

  const dramaConfig = sceneKeys.map((scNum, idx) => {
    const planScene = scenePlan?.scenes?.find(ps => ps.id === scNum) || {};
    const isFirst = idx === 0;
    const isLast = idx === sceneKeys.length - 1;

    // Pose: shocked, urgent, chill, host
    let pose = planScene.pose;
    if (!pose) {
      if (isFirst) pose = 'shocked';
      else if (isLast) pose = 'host';
      else if (idx % 2 === 0) pose = 'urgent';
      else pose = 'chill';
    }

    // Role: reaction_overlay, guide_sidecar, presenter_full, absent
    let role = planScene.role;
    if (!role) {
      if (isLast) role = 'presenter_full';
      else if (idx % 2 === 1) role = 'guide_sidecar';
      else role = 'reaction_overlay';
    }

    // Tag danh mục & màu
    let tag = planScene.tag;
    let tagColor = planScene.tagColor;
    if (!tag) {
      if (isFirst) { tag = 'TIN NÓNG ĐIỆN ẢNH'; tagColor = '#EF4444'; }
      else if (isLast) { tag = 'GÓC TRANH LUẬN'; tagColor = '#F59E0B'; }
      else if (idx === 1) { tag = 'NGUỒN CƠN DRAMA'; tagColor = '#F97316'; }
      else if (idx === 2) { tag = 'BẰNG CHỨNG XÁC THỰC'; tagColor = '#10B981'; }
      else { tag = 'DƯ LUẬN DẬY SÓNG'; tagColor = '#EC4899'; }
    }
    if (!tagColor) tagColor = '#EF4444';

    // Headline callout
    let headlineCallout = planScene.headlineCallout;
    let headlineColor = planScene.headlineColor;
    if (!headlineCallout) {
      if (isFirst) { headlineCallout = 'TRANH CÃI GAY GẮT!'; headlineColor = '#DC2626'; }
      else if (isLast) { headlineCallout = 'Ý KIẾN CỦA BẠN THẾ NÀO?'; headlineColor = '#D97706'; }
      else if (idx === 1) { headlineCallout = 'XÔN XAO CỘNG ĐỒNG'; headlineColor = '#EA580C'; }
      else { headlineCallout = 'SỰ THẬT ĐẰNG SAU?'; headlineColor = '#B91C1C'; }
    }
    if (!headlineColor) headlineColor = '#DC2626';

    const highlightWords = Array.isArray(planScene.highlightWords) && planScene.highlightWords.length > 0
      ? planScene.highlightWords
      : ['TRANH CÃI', 'XÔN XAO', 'BỘ PHIM', 'CỘNG ĐỒNG', 'SỰ THẬT', 'KHÁN GIẢ'];

    return {
      id: scNum,
      pose,
      role,
      tag,
      tagColor,
      headlineCallout,
      headlineColor,
      highlightWords
    };
  });

  await writeFile(path.join(publicTarget, 'drama-config.json'), JSON.stringify(dramaConfig, null, 2), 'utf8');

  // 3. Tạo template DramaVideo.tsx
  const runnerSrcDir = path.join(remotionRoot, 'src', 'video-bot-runner');
  await mkdir(runnerSrcDir, {recursive: true});

  const dramaComponentContent = `import React from 'react';
import type {Caption as RemotionCaption} from '@remotion/captions';
import {Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';
import durationsRaw from '../../public/video-bot/${displayId}/durations.json';
import captionData from '../../public/video-bot/${displayId}/captions.json';
import dramaConfigRaw from '../../public/video-bot/${displayId}/drama-config.json';

type SceneCaptions = {scene: number; captions: RemotionCaption[]};
type DramaSceneConfig = {
  id: number;
  pose: 'host' | 'urgent' | 'shocked' | 'chill' | 'absent';
  role: 'reaction_overlay' | 'guide_sidecar' | 'presenter_full' | 'absent';
  tag: string;
  tagColor: string;
  headlineCallout: string;
  headlineColor: string;
  highlightWords: string[];
};

const durations = durationsRaw as Record<string, number>;
const dramaConfig = dramaConfigRaw as DramaSceneConfig[];
const captionsByScene = captionData as SceneCaptions[];

const scenes = Object.entries(durations).map(([key, seconds]) => {
  const scNum = Number(key);
  const cfg = dramaConfig.find((c) => c.id === scNum) || dramaConfig[scNum - 1] || dramaConfig[0];
  return {
    scene: scNum,
    seconds,
    audio: 'video-bot/${displayId}/audio/vo_' + String(key).padStart(2, '0') + '.wav',
    cfg
  };
});

const HOLD_FRAMES = 12;
const sceneFrames = scenes.map((s, idx) => {
  // Hold thêm 1.5s (45 frames) ở cảnh cuối để viewer đọc CTA tranh luận
  const extra = idx === scenes.length - 1 ? 45 : HOLD_FRAMES;
  return Math.ceil(s.seconds * 30) + extra;
});
export const TOTAL_FRAMES = sceneFrames.reduce((sum, value) => sum + value, 0);

// Chuyển động toán học khử rung giật
const mathAnim = {
  breathe: (t: number) => {
    const period = 2.0;
    const y = Math.sin(t * ((2 * Math.PI) / period)) * 5;
    const scale = 1.0 + Math.sin(t * ((2 * Math.PI) / period)) * 0.015;
    const rot = Math.sin(t * ((2 * Math.PI) / (period * 2))) * 1.0;
    return {y, scale, rot};
  },
  subPop: (t: number) => {
    const popDur = 0.18;
    if (t > popDur) return 1.0;
    const p = t / popDur;
    return 1.0 + Math.sin(p * Math.PI) * 0.06;
  },
  mediaDrift: (t: number) => {
    const scale = 1.02 + Math.sin(t * 0.8) * 0.035;
    const x = Math.sin(t * 0.5) * 6;
    const y = Math.cos(t * 0.6) * 5;
    return {scale, x, y};
  }
};

const getPoseImg = (pose: string): string => {
  switch (pose) {
    case 'urgent': return staticFile('drama_pubg/mascot/capy_urgent.png');
    case 'shocked': return staticFile('drama_pubg/mascot/capy_shocked.png');
    case 'chill': return staticFile('drama_pubg/mascot/capy_chill.png');
    case 'host':
    default: return staticFile('drama_pubg/mascot/capy_host.png');
  }
};

const SubtitleBanner: React.FC<{text: string; highlights: string[]; scale: number}> = ({text, highlights, scale}) => {
  const words = text.split(' ');
  return (
    <div
      style={{
        transform: 'scale(' + scale + ')',
        display: 'inline-flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '6px 12px',
        background: 'rgba(10, 14, 24, 0.95)',
        backdropFilter: 'blur(20px)',
        borderRadius: '22px',
        border: '2.5px solid rgba(255, 215, 0, 0.85)',
        boxShadow: '0 18px 50px rgba(0, 0, 0, 0.85), 0 0 30px rgba(255, 215, 0, 0.25)',
        padding: '14px 28px',
        maxWidth: '960px',
        textAlign: 'center'
      }}
    >
      {words.map((w, idx) => {
        const cleanWord = w.replace(/[!?,.:]/g, '').toUpperCase();
        const isHigh = highlights.some((hw) => hw.toUpperCase().includes(cleanWord));
        return (
          <span
            key={idx}
            style={{
              fontFamily: 'Segoe UI, Be Vietnam Pro, Montserrat, sans-serif',
              fontSize: '38px',
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              lineHeight: 1.25,
              color: isHigh ? '#FFE500' : '#FFFFFF',
              textShadow: isHigh
                ? '0 3px 14px rgba(255, 229, 0, 0.7), 0 2px 6px rgba(0,0,0,0.95)'
                : '0 3px 10px rgba(0,0,0,0.9)'
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

const HeadlineCallout: React.FC<{text: string; color: string; isStamp: boolean; frame: number; fps: number}> = ({
  text, color, isStamp, frame, fps
}) => {
  const pop = spring({frame, fps, config: {damping: 12, stiffness: 140}});
  if (isStamp) {
    return (
      <div
        style={{
          position: 'absolute',
          top: '42%',
          left: '6%',
          right: '6%',
          transform: 'scale(' + pop + ') rotate(-10deg)',
          zIndex: 25,
          background: 'rgba(220, 20, 20, 0.95)',
          border: '5px solid #FFFFFF',
          borderRadius: '20px',
          padding: '16px 20px',
          color: '#FFFFFF',
          fontFamily: 'Segoe UI, Impact, sans-serif',
          fontSize: '56px',
          fontWeight: 900,
          letterSpacing: '2.5px',
          textAlign: 'center',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9), 0 0 40px rgba(220, 20, 20, 0.8)',
          textTransform: 'uppercase'
        }}
      >
        {text}
      </div>
    );
  }
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '30px',
        left: '24px',
        right: '24px',
        transform: 'scale(' + pop + ')',
        zIndex: 25,
        background: color,
        border: '3.5px solid #FFFFFF',
        borderRadius: '18px',
        padding: '14px 20px',
        color: '#FFFFFF',
        fontFamily: 'Segoe UI, Montserrat, sans-serif',
        fontSize: '36px',
        fontWeight: 900,
        textAlign: 'center',
        boxShadow: '0 14px 40px rgba(0, 0, 0, 0.9), 0 0 25px rgba(255, 255, 255, 0.4)',
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        textShadow: '0 2px 8px rgba(0, 0, 0, 0.75)'
      }}
    >
      {text}
    </div>
  );
};

const DramaScene: React.FC<{
  sceneData: typeof scenes[0];
  cues: RemotionCaption[];
  index: number;
  frames: number;
  globalStartFrame: number;
}> = ({sceneData, cues, index, frames, globalStartFrame}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const globalFrame = globalStartFrame + frame;
  const globalT = globalFrame / fps;
  const localT = frame / fps;
  const durSec = frames / fps;

  // Subtitle cue
  const timeMs = (frame * 1000) / fps;
  const activeCue = cues.find((c) => timeMs >= c.startMs && timeMs < c.endMs) || cues[cues.length - 1];
  const activeText = activeCue?.text || '';
  const subPopScale = mathAnim.subPop(localT % 0.8);

  const breathe = mathAnim.breathe(globalT);
  const mediaDrift = mathAnim.mediaDrift(globalT);
  const cardOpacity = interpolate(frame, [0, 4], [0.85, 1], {extrapolateRight: 'clamp'});

  // Vị trí mascot theo role
  const cfg = sceneData.cfg;
  let mascotStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '370px',
    right: '30px',
    width: '290px',
    zIndex: 30,
    filter: 'drop-shadow(0 15px 30px rgba(0, 0, 0, 0.75))',
    transform: 'translateY(' + breathe.y + 'px) scale(' + breathe.scale + ') rotate(' + breathe.rot + 'deg)'
  };
  if (cfg.role === 'guide_sidecar') {
    mascotStyle = {
      position: 'absolute',
      bottom: '370px',
      left: '30px',
      width: '300px',
      zIndex: 30,
      filter: 'drop-shadow(0 15px 30px rgba(0, 0, 0, 0.75))',
      transform: 'translateY(' + breathe.y + 'px) scale(' + breathe.scale + ') rotate(' + (-breathe.rot) + 'deg)'
    };
  } else if (cfg.role === 'presenter_full') {
    mascotStyle = {
      position: 'absolute',
      bottom: '370px',
      left: '50%',
      marginLeft: '-180px',
      width: '360px',
      zIndex: 30,
      filter: 'drop-shadow(0 20px 40px rgba(0, 0, 0, 0.85))',
      transform: 'translateY(' + breathe.y + 'px) scale(' + (breathe.scale * 1.05) + ') rotate(' + (breathe.rot * 0.8) + 'deg)'
    };
  }

  const sceneImgSrc = staticFile('video-bot/${displayId}/scenes/scene_' + String(index + 1).padStart(2, '0') + '.png');

  return (
    <div style={{position: 'absolute', inset: 0, backgroundColor: '#070a10', overflow: 'hidden'}}>
      {/* Background Cyber Ambient Glow */}
      <div
        style={{
          position: 'absolute',
          top: -100,
          left: -100,
          width: 1280,
          height: 800,
          background: 'radial-gradient(circle at 50% 30%, rgba(220, 38, 38, 0.22) 0%, rgba(0,0,0,0) 70%)',
          zIndex: 1
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 1080,
          height: 700,
          background: 'radial-gradient(circle at 50% 90%, rgba(217, 119, 6, 0.16) 0%, rgba(0,0,0,0) 70%)',
          zIndex: 1
        }}
      />

      {/* Watermark DRAMA HOT HIT */}
      <div
        style={{
          position: 'absolute',
          top: '48%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotate(-30deg)',
          fontFamily: 'Segoe UI, Impact, sans-serif',
          fontSize: '90px',
          fontWeight: 900,
          color: 'rgba(255, 255, 255, 0.05)',
          letterSpacing: '8px',
          pointerEvents: 'none',
          zIndex: 5,
          whiteSpace: 'nowrap'
        }}
      >
        DRAMA HOT HIT
      </div>

      {/* Brand Header */}
      <div
        style={{
          position: 'absolute',
          top: '54px',
          left: '50px',
          right: '50px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 25
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            padding: '6px 16px',
            borderRadius: '14px',
            border: '1.5px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5)'
          }}
        >
          <span style={{fontFamily: 'Segoe UI, Montserrat, sans-serif', fontSize: '24px', fontWeight: 900, color: '#FFFFFF'}}>DRAMA</span>
          <span
            style={{
              fontFamily: 'Segoe UI, Montserrat, sans-serif',
              fontSize: '24px',
              fontWeight: 900,
              color: '#EF4444',
              background: 'rgba(239, 68, 68, 0.18)',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid #EF4444'
            }}
          >
            HOT HIT
          </span>
        </div>

        <div
          style={{
            background: cfg.tagColor,
            color: '#FFFFFF',
            fontFamily: 'Segoe UI, sans-serif',
            fontWeight: 800,
            fontSize: '22px',
            padding: '8px 20px',
            borderRadius: '12px',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)'
          }}
        >
          {cfg.tag}
        </div>
      </div>

      {/* Center Evidence Media Card */}
      <div
        style={{
          position: 'absolute',
          top: '135px',
          left: '50px',
          width: '980px',
          height: '1050px',
          zIndex: 10,
          transform: 'scale(' + mediaDrift.scale + ') translate(' + mediaDrift.x + 'px, ' + mediaDrift.y + 'px)',
          opacity: cardOpacity,
          borderRadius: '28px',
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(220, 38, 38, 0.2)',
          border: '2px solid rgba(255, 255, 255, 0.15)',
          backgroundColor: '#0d1117'
        }}
      >
        {/* Blurred backdrop */}
        <Img
          src={sceneImgSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(24px) brightness(0.35)',
            transform: 'scale(1.15)'
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src.endsWith('.png')) target.src = target.src.replace('.png', '.jpg');
          }}
        />

        {/* Crisp foreground */}
        <Img
          src={sceneImgSrc}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            zIndex: 2
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src.endsWith('.png')) target.src = target.src.replace('.png', '.jpg');
          }}
        />

        {/* Real Proof Badge */}
        <div
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 15,
            background: 'rgba(10, 14, 24, 0.88)',
            backdropFilter: 'blur(12px)',
            border: '1.5px solid rgba(255, 215, 0, 0.7)',
            borderRadius: '12px',
            padding: '8px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFE500',
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '20px',
            fontWeight: 800,
            boxShadow: '0 6px 16px rgba(0, 0, 0, 0.5)'
          }}
        >
          <span>✓</span> BẰNG CHỨNG XÁC THỰC
        </div>

        {/* Headline Callout */}
        <HeadlineCallout
          text={cfg.headlineCallout}
          color={cfg.headlineColor}
          isStamp={index === 0}
          frame={frame}
          fps={fps}
        />
      </div>

      {/* Mascot Performer */}
      {cfg.pose !== 'absent' && (
        <div style={mascotStyle}>
          <Img
            src={getPoseImg(cfg.pose)}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block'
            }}
          />
        </div>
      )}

      {/* Subtitle Banner (Safe-Zone at bottom 240px) */}
      <div
        style={{
          position: 'absolute',
          bottom: '240px',
          left: '50px',
          right: '50px',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 40
        }}
      >
        <SubtitleBanner
          text={activeText}
          highlights={cfg.highlightWords}
          scale={subPopScale}
        />
      </div>

      {/* Scene VO Audio */}
      <Audio src={staticFile(sceneData.audio)} volume={1.3} />
    </div>
  );
};

export const DramaVideo: React.FC = () => {
  const frame = useCurrentFrame();
  let start = 0;
  const entries = scenes.map((s, index) => {
    const from = start;
    const duration = sceneFrames[index];
    start += duration;
    return (
      <Sequence key={s.scene} from={from} durationInFrames={duration}>
        <DramaScene
          sceneData={s}
          cues={captionsByScene[index]?.captions || []}
          index={index}
          frames={duration}
          globalStartFrame={from}
        />
      </Sequence>
    );
  });

  return (
    <div style={{width: '100%', height: '100%', background: '#000000', position: 'relative'}}>
      {/* SFX Heavy Boom ở Hook */}
      <Sequence from={0} durationInFrames={90}>
        <Audio src={staticFile('drama_pubg/sfx/sfx_heavy_boom.wav')} volume={0.85} />
      </Sequence>

      {/* Urgent News Pulse BGM */}
      <Audio
        src={staticFile('drama_pubg/bgm/urgent_news_pulse_bgm.wav')}
        loop
        volume={(f) => {
          if (f < 30) return interpolate(f, [0, 30], [0, 0.10]);
          return 0.10;
        }}
      />

      {entries}
    </div>
  );
};
`;

  const indexContent = `import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {DramaVideo, TOTAL_FRAMES} from './DramaVideo';

const Root: React.FC = () => (
  <Composition
    id="DramaVideo"
    component={DramaVideo}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1080}
    height={1920}
  />
);

registerRoot(Root);
`;

  await writeFile(path.join(runnerSrcDir, 'DramaVideo.tsx'), dramaComponentContent, 'utf8');
  await writeFile(path.join(runnerSrcDir, 'index.tsx'), indexContent, 'utf8');

  return runRemotionRender({
    compositionId: 'DramaVideo',
    entryPath: 'src/video-bot-runner/index.tsx',
    outputMp4: path.join(jobDir, `${displayId}.mp4`),
    displayId,
    remotionRoot,
    chromePath,
    signal,
    onProgress
  });
}

function runRemotionRender({
  compositionId,
  entryPath,
  outputMp4,
  displayId,
  remotionRoot,
  chromePath,
  signal,
  onProgress
}) {
  const renderArgs = [
    'remotion', 'render',
    entryPath,
    compositionId,
    `"${outputMp4}"`,
    `--browser-executable="${chromePath}"`,
    '--browser-timeout=120000',
    '--concurrency=1'
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('npx.cmd', renderArgs, {
      cwd: remotionRoot,
      shell: true,
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
