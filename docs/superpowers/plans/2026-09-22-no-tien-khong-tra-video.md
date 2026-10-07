# “Nợ Tiền Không Trả” Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a 16-scene Vietnamese vertical moral-story MP4 titled “Nợ tiền không trả”, with generated scene art, VieNeu-TTS narration, captions, restrained sound design, and no scene 17 or book promo.

**Architecture:** A JSON scene manifest is the single source of truth for narration, caption chunks, image prompts, and sound cues. A project-specific Python generator creates one WAV per scene plus measured duration/caption JSON; a focused Remotion module consumes those files and mounts each VO inside its matching `Sequence`. Generated images and copied audio assets live under a project-specific `public/` subtree, and a Node validator plus FFprobe checks protect the 16-scene contract.

**Tech Stack:** React 19, TypeScript 5.9, Remotion 4.0.500, VieNeu-TTS, Python 3, soundfile, PyTorch, Node.js, FFmpeg/FFprobe, built-in image generation.

**Spec:** `docs/superpowers/specs/2026-09-22-no-tien-khong-tra-video-design.md`

## Global Constraints

- Exactly 16 story scenes: keep script scenes 1–16; exclude scene 17 and all book-promo shots B1–B4.
- Output is `1080x1920`, `30 fps`, H.264/AAC MP4 with an audible audio stream.
- Use local VieNeu-TTS voice `tinhtri`; create one WAV per scene and derive timing from measured audio.
- Use 16 generated portrait `9:16` images in the approved minimalist flat 2D stick-figure style.
- Render all Vietnamese title/caption text in Remotion, never in generated images.
- Put each scene VO `<Audio>` inside the same scene `<Sequence>`; mount looping BGM at composition root.
- Caption safe zone: `left: 70`, `right: 230`, vertical placement around 65–72% of the frame, Segoe UI/Arial, weight 800, amber text with restrained dark outline.
- Animate only with `useCurrentFrame()` and deterministic math; no CSS keyframes.
- Do not alter or clean unrelated dirty-worktree files.

---

## File Map

- Create `src/no-tien-khong-tra/scenes.json`: canonical 16-scene narration, caption chunks, visual prompts, and SFX paths.
- Create `src/no-tien-khong-tra/types.ts`: shared `StoryScene`, `CaptionCue`, and `TimedScene` types.
- Create `src/no-tien-khong-tra/timeline.ts`: deterministic duration-to-frame timeline builder.
- Create `src/no-tien-khong-tra/NoTienKhongTraVideo.tsx`: scene rendering, captions, title, card text, VO/BGM/SFX, and total-frame export.
- Create `src/no_tien_khong_tra_durations.json`: generated measured scene durations.
- Create `src/no_tien_khong_tra_captions.json`: generated caption cues relative to each scene.
- Create `generate_no_tien_khong_tra_audio.py`: idempotent VieNeu-TTS generator and timing writer.
- Create `scripts/validate-no-tien-khong-tra.mjs`: validates the manifest and required generated assets.
- Create `public/no-tien-khong-tra/scenes/scene-01.png` … `scene-16.png`: generated portrait art.
- Create `public/audio/no-tien-khong-tra/vo/vo_01.wav` … `vo_16.wav`: generated narration.
- Create `public/audio/no-tien-khong-tra/bgm/no-tien-khong-tra-piano.wav`: isolated BGM copy.
- Create `public/audio/no-tien-khong-tra/sfx/*.wav`: isolated copies of selected restrained SFX.
- Modify `src/Root.tsx`: add one import and one composition registration only.
- Create `output/no-tien-khong-tra.mp4`: final render.
- Create `output/no-tien-khong-tra-preview.png`: representative final frame.

---

### Task 1: Create the canonical 16-scene manifest and validator

**Files:**
- Create: `src/no-tien-khong-tra/scenes.json`
- Create: `src/no-tien-khong-tra/types.ts`
- Create: `scripts/validate-no-tien-khong-tra.mjs`

**Interfaces:**
- Produces: `StoryScene[]`, where each scene has `id`, `narration`, `captions`, `imagePrompt`, and optional `sfx`.
- Produces: `node scripts/validate-no-tien-khong-tra.mjs --manifest-only`, which exits 0 only for IDs 1–16 in order and rejects scene 17/promo content.

- [ ] **Step 1: Write the manifest validator first**

Create a Node ESM script that loads `src/no-tien-khong-tra/scenes.json` and enforces the exact contract:

```js
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const scenes = JSON.parse(fs.readFileSync(path.join(root, "src/no-tien-khong-tra/scenes.json"), "utf8"));
const expectedIds = Array.from({length: 16}, (_, index) => index + 1);
const ids = scenes.map((scene) => scene.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw new Error(`Expected scene IDs 1..16, got ${ids.join(",")}`);
for (const scene of scenes) {
  if (!scene.narration?.trim()) throw new Error(`Scene ${scene.id} has no narration`);
  if (!Array.isArray(scene.captions) || scene.captions.length === 0) throw new Error(`Scene ${scene.id} has no captions`);
  if (!scene.imagePrompt?.trim()) throw new Error(`Scene ${scene.id} has no image prompt`);
}
const serialized = JSON.stringify(scenes).toLowerCase();
if (serialized.includes("scene 17") || serialized.includes("giỏ hàng") || serialized.includes("thay đổi một suy nghĩ")) {
  throw new Error("Manifest contains excluded scene 17 or book promo content");
}
if (!process.argv.includes("--manifest-only")) {
  for (const id of expectedIds) {
    const number = String(id).padStart(2, "0");
    for (const relative of [
      `public/no-tien-khong-tra/scenes/scene-${number}.png`,
      `public/audio/no-tien-khong-tra/vo/vo_${number}.wav`,
    ]) {
      const absolute = path.join(root, relative);
      if (!fs.existsSync(absolute) || fs.statSync(absolute).size < 4000) throw new Error(`Missing or empty ${relative}`);
    }
  }
}
console.log(`Validated ${scenes.length} scenes.`);
```

- [ ] **Step 2: Run the validator to verify the fixture is missing**

Run: `node scripts/validate-no-tien-khong-tra.mjs --manifest-only`

Expected: FAIL with `ENOENT` for `src/no-tien-khong-tra/scenes.json`.

- [ ] **Step 3: Add shared types**

```ts
export type StoryScene = {
  id: number;
  narration: string;
  captions: string[];
  imagePrompt: string;
  sfx?: {path: string; volume: number; offsetFrames?: number}[];
};

export type CaptionCue = {
  scene: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type TimedScene = StoryScene & {
  startFrame: number;
  durationInFrames: number;
};
```

- [ ] **Step 4: Add the full manifest**

Use the exact VO and caption lines below. Every `imagePrompt` must start with this shared lock in its own string: `Portrait 9:16, flat 2D vector stick-figure illustration, plain white circular heads, thick black outlines, dot eyes, thin eyebrows, tiny line mouths, no noses, matte solid colors, at most one cel-shadow tone, cold desaturated blue-gray ruined world, warm white spotlight, warm gold accents, no text, no watermark, no anime, no 3D, no realistic anatomy.` Append these exact scene actions:

1. VO: `Bao giờ bạn tự hỏi: vì sao người vay tiền không trả càng ngày càng nghèo đi? Vì mỗi món nợ không trả là một hạt giống nghèo hèn bạn tự gieo cho mình.` Captions: `Bao giờ bạn tự hỏi: vì sao` / `người vay tiền không trả` / `càng ngày càng nghèo đi?` / `Mỗi món nợ không trả` / `là một hạt giống nghèo hèn tự gieo.` Action: NHAN in blue hoodie drops a gold coin seed beside a withered thorn plant bearing a broken bowl, cracked coin and red down arrow; debt paper chained to his red-watch wrist; glowing question mark overhead.
2. VO: `Ở đời, có một luật công bằng nhất: có nợ, thì phải trả.` Captions: `Ở đời, có một luật công bằng nhất:` / `có nợ, thì phải trả.` Action: BAN in beige jacket gives NHAN an envelope of gold coins; bronze balance scale between them; green check medallion above hands.
3. VO: `Bạn có thể giấu, có thể chạy — nhưng món nợ không bao giờ quên bạn.` Captions: `Bạn có thể giấu, có thể chạy,` / `nhưng món nợ không bao giờ quên bạn.` Action: NHAN runs in panic while chained to a monstrous floating debt paper with shadow claws, smoke, scraps, speed lines and dust.
4. VO: `Không sớm thì muộn, không đời này thì đời khác, món nợ luôn đợi bạn ở cửa để đòi.` Captions: `Không sớm thì muộn,` / `không đời này thì đời khác,` / `món nợ luôn đợi bạn ở cửa để đòi.` Action: NHAN stands on a bronze scale between debt paper and heavy weight; giant cracked clock and pouring hourglass flank him.
5. VO: `Hãy nhớ: người cho bạn vay tiền không phải vì họ dư dả — mà vì họ tin bạn và quý bạn.` Captions: `Người cho bạn vay tiền` / `không phải vì họ dư dả,` / `mà vì họ tin bạn và quý bạn.` Action: BAN gives a glowing coin envelope to surprised NHAN; both touch chest; shield-check and heart icons glow above.
6. VO: `Nên trả nợ không chỉ là trả tiền — mà là trả lại niềm tin.` Captions: `Trả nợ không chỉ là trả tiền,` / `mà là trả lại niềm tin.` Action: NHAN and BAN shake hands warmly beneath heart, shield-check and signed-contract icons; glowing coin envelope on a side table.
7. VO: `Giữ tiền lại rồi bỏ đi, bạn mất nhiều hơn tiền: bạn mất lòng một người tốt.` Captions: `Giữ tiền lại rồi bỏ đi,` / `bạn mất nhiều hơn tiền:` / `mất lòng một người tốt.` Action: guilty NHAN walks away hiding a money bag; BAN reaches out confused; a handshake speech bubble cracks with red lightning.
8. VO: `Chuyện xưa kể: kiếp trước có người thiếu nợ chỉ một túi muối,` Captions: `Chuyện xưa kể: kiếp trước` / `có người thiếu nợ chỉ một túi muối,` Action: NHAN thinks beside a large sepia bubble showing two ancient villagers in brown coarse robes exchanging a white salt sack tied by red thread to a glowing coin stack.
9. VO: `kiếp này phải đầu thai làm trâu, cày ruộng trả nợ.` Captions: `kiếp này phải đầu thai làm trâu,` / `cày ruộng trả nợ.` Action: dusk road, tired black water buffalo carries two salt sacks; translucent sad spirit descends toward it; NHAN watches from a rock; muted sunset mountains.
10. VO: `Và hãy nhớ: nợ chưa trả cũng đẻ lãi. Mỗi ngày bạn chậm, món nợ lại lớn thêm.` Captions: `Nợ chưa trả cũng đẻ lãi.` / `Mỗi ngày bạn chậm,` / `món nợ lại lớn thêm.` Action: worried NHAN at a wooden desk with stamped debt paper; calendar sequence points to growing gold coin stacks and a red rising arrow.
11. VO: `Như tiền gửi ngân hàng: càng để lâu, lãi càng nhiều. Chỉ khác một điều — người trả lãi là bạn.` Captions: `Như tiền gửi ngân hàng:` / `càng để lâu, lãi càng nhiều.` / `Chỉ khác: người trả lãi là bạn.` Action: NHAN points between a gray bank with a coin slot and a growing coin-stack bar chart with a red rising arrow.
12. VO: `Phật dạy: tiền bạc phải phân minh, tình cảm phải dứt khoát. Đừng để nợ làm mờ tình bạn.` Captions: `Tiền bạc phải phân minh,` / `tình cảm phải dứt khoát,` / `đừng để nợ làm mờ tình bạn.` Action: night temple courtyard, serene NHAN with open palms; glowing lotus, Dharma wheel, bronze scale and a divided heart/sunrise choice motif.
13. VO: `Vay không trả không phải khôn ngoan — mà là ích kỷ và tráo trở đội lốt tinh khôn.` Captions: `Vay không trả không phải khôn ngoan,` / `mà là ích kỷ và tráo trở` / `đội lốt tinh khôn.` Action: NHAN sneaks away clutching banknotes behind his back; mask and thief icons hover; sad BAN reaches after him.
14. VO: `Và cuối cùng, nghiệp nghèo hèn bạn gieo — chính bạn tự gặt.` Captions: `Và cuối cùng,` / `nghiệp nghèo hèn bạn gieo,` / `chính bạn tự gặt.` Action: kneeling NHAN plants a coin seed; thorny barren tree grows with broken bowl, torn wallet, cracked coin and down arrow; roots wrap a debt paper.
15. VO: `Có nợ hãy trả nhanh: trả đời này thì hết; để chậm, nợ theo sang đời sau.` Captions: `Có nợ hãy trả nhanh:` / `trả đời này thì hết,` / `để chậm, nợ theo sang đời sau.` Action: night crossroads with a vine-wrapped hourglass; one path shows repayment and warm coin stepping stones, the other a dark silhouette walking toward a distant debt paper.
16. VO: `Nhớ ba điều: một, có nợ phải trả. Hai, trả nợ là trả niềm tin. Ba, trả càng chậm, nợ càng to.` Captions: `1. Có nợ phải trả.` / `2. Trả nợ = trả niềm tin.` / `3. Trả càng chậm, nợ càng to.` Action: minimalist nearly black card with three vertically aligned glowing icon rows only—coin with green check, handshake inside red heart, growing coin stacks with red arrow—ample empty space for editor text.

Assign restrained SFX only to scenes 1 (`sfx/coin.wav`, `sfx/whoosh.wav`), 2 (`sfx/chime.wav`), 4 (`sfx/ticking.wav`), 9 (`sfx/footstep-heavy.wav`), 12 (`sfx/bell-cold.wav`), 14 (`sfx/soft-wind.wav`), and 16 (`sfx/chime.wav`), all at volume `0.08–0.16`.

- [ ] **Step 5: Verify the manifest passes**

Run: `node scripts/validate-no-tien-khong-tra.mjs --manifest-only`

Expected: `Validated 16 scenes.`

- [ ] **Step 6: Commit the manifest contract**

```powershell
git add -- src/no-tien-khong-tra/scenes.json src/no-tien-khong-tra/types.ts scripts/validate-no-tien-khong-tra.mjs
git commit -m "feat: define no tien khong tra scenes"
```

---

### Task 2: Generate and inspect the 16 portrait scene images

**Files:**
- Create: `public/no-tien-khong-tra/scenes/scene-01.png` … `scene-16.png`

**Interfaces:**
- Consumes: `imagePrompt` from each manifest item.
- Produces: 16 non-empty portrait PNG files at the exact paths expected by the validator and Remotion.

- [ ] **Step 1: Generate one image per manifest prompt**

Use one built-in image-generation call per scene. Do not request text in any image. For scenes with NHAN, repeat his blue hoodie, black trousers, white sneakers, bald white circular head and red watch. For scenes with BAN, repeat his beige jacket, olive cargo trousers and dark boots.

- [ ] **Step 2: Copy each accepted output into the workspace**

Name outputs exactly `scene-01.png` through `scene-16.png` under `public/no-tien-khong-tra/scenes/`. Do not leave Remotion-referenced images only under the tool’s default generated-image directory.

- [ ] **Step 3: Inspect every image**

Use image inspection for all 16 files and reject any frame with extra limbs, realistic/anime faces, 3D rendering, watermark, generated words, wrong clothing, landscape framing, or subject matter inconsistent with its scene action. Regenerate only the failing image with one targeted correction.

- [ ] **Step 4: Verify image dimensions and inventory**

Run a PowerShell loop using ImageMagick `identify` if available; otherwise use FFprobe:

```powershell
Get-ChildItem -LiteralPath 'public\no-tien-khong-tra\scenes' -Filter 'scene-*.png' | Sort-Object Name | ForEach-Object {
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 -- $_.FullName
}
```

Expected: 16 portrait images, each with height greater than width.

- [ ] **Step 5: Commit the approved art**

```powershell
git add -- public/no-tien-khong-tra/scenes
git commit -m "feat: add no tien khong tra scene art"
```

---

### Task 3: Generate measured VieNeu-TTS narration and project audio assets

**Files:**
- Create: `generate_no_tien_khong_tra_audio.py`
- Create: `src/no_tien_khong_tra_durations.json`
- Create: `src/no_tien_khong_tra_captions.json`
- Create: `public/audio/no-tien-khong-tra/vo/vo_01.wav` … `vo_16.wav`
- Create: `public/audio/no-tien-khong-tra/bgm/no-tien-khong-tra-piano.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/coin.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/whoosh.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/chime.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/ticking.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/footstep-heavy.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/bell-cold.wav`
- Create: `public/audio/no-tien-khong-tra/sfx/soft-wind.wav`

**Interfaces:**
- Consumes: `src/no-tien-khong-tra/scenes.json`.
- Produces: duration JSON shaped as `Record<string, number>` in seconds, including a 0.30-second visual tail per scene.
- Produces: `CaptionCue[]` with scene-relative `startMs`/`endMs`, proportionally timed by caption character length.

- [ ] **Step 1: Create an idempotent audio generator**

Implement the same proven runtime contract as `generate_mother_story_audio.py`: append `D:/viet tts/VieNeu-TTS` to `sys.path`, initialize `VieNeuTTS` with `pnnbao-ump/VieNeu-TTS-q4-gguf` on CPU and `neuphonic/neucodec-onnx-decoder`, load `sample/tinhtri.pt` and `sample/tinhtri.txt`, call `tts.infer(narration, ref_codes, ref_text)`, and save 24 kHz WAV with `soundfile.write`. Read narration/captions from the manifest instead of duplicating copy.

The generator must skip an existing WAV larger than 4000 bytes, retry each failed inference three times, measure duration with Python’s `wave` module, add `0.30` seconds to each scene duration, and write caption timings relative to scene start:

```py
def build_captions(scene_id: int, chunks: list[str], speech_ms: int):
    total = max(1, sum(len(chunk) for chunk in chunks))
    elapsed = 0
    cues = []
    for chunk in chunks:
        start_ms = round(speech_ms * elapsed / total)
        elapsed += len(chunk)
        end_ms = round(speech_ms * elapsed / total)
        cues.append({"scene": scene_id, "text": chunk, "startMs": start_ms, "endMs": max(start_ms + 1, end_ms)})
    return cues
```

- [ ] **Step 2: Run TTS with the project’s VieNeu Python**

Run:

```powershell
& 'D:\viet tts\VieNeu-TTS\.venv\Scripts\python.exe' .\generate_no_tien_khong_tra_audio.py
```

Expected: 16 successful scene lines, 16 WAV files, duration JSON with keys `1`–`16`, and caption JSON containing all approved chunks.

- [ ] **Step 3: Copy isolated BGM and SFX**

Use `Copy-Item -LiteralPath` to copy these existing workspace assets into `public/audio/no-tien-khong-tra/`:

- BGM: `public/audio/mother-story/bgm/mother-story-inspired-piano.wav` → `bgm/no-tien-khong-tra-piano.wav`
- Coin: `public/sfx/coin.wav` → `sfx/coin.wav`
- Whoosh: `public/sfx/whoosh.wav` → `sfx/whoosh.wav`
- Chime: `public/audio/triet_li_song_sau/sfx/sfx_chime.wav` → `sfx/chime.wav`
- Ticking: `public/audio/sfx/ticking.wav` → `sfx/ticking.wav`
- Footstep: `public/audio/su_hiem_doc_long_nguoi/sfx/sfx_footstep_heavy.wav` → `sfx/footstep-heavy.wav`
- Bell: `public/audio/su_hiem_doc_long_nguoi/sfx/sfx_bell_cold.wav` → `sfx/bell-cold.wav`
- Wind: `public/audio/dong_chay_4_tieng/sfx/sfx_23_wind.wav` → `sfx/soft-wind.wav`

- [ ] **Step 4: Validate all scene assets**

Run: `node scripts/validate-no-tien-khong-tra.mjs`

Expected: `Validated 16 scenes.`

- [ ] **Step 5: Probe narration duration and audibility**

Run:

```powershell
Get-ChildItem -LiteralPath 'public\audio\no-tien-khong-tra\vo' -Filter 'vo_*.wav' | Sort-Object Name | ForEach-Object {
  ffprobe -v error -show_entries format=filename,duration -of csv=p=0 -- $_.FullName
}
```

Expected: 16 positive durations and no zero-byte/silent file.

- [ ] **Step 6: Commit generated audio and timing data**

```powershell
git add -- generate_no_tien_khong_tra_audio.py src/no_tien_khong_tra_durations.json src/no_tien_khong_tra_captions.json public/audio/no-tien-khong-tra
git commit -m "feat: add measured narration for debt story"
```

---

### Task 4: Implement deterministic timeline and Remotion composition

**Files:**
- Create: `src/no-tien-khong-tra/timeline.ts`
- Create: `src/no-tien-khong-tra/NoTienKhongTraVideo.tsx`

**Interfaces:**
- Consumes: `StoryScene[]`, duration JSON, caption JSON, static image/audio paths.
- Produces: `buildTimeline(fps: number): TimedScene[]`.
- Produces: `computeNoTienKhongTraFrames(): number`.
- Produces: `NoTienKhongTraVideo: React.FC`.

- [ ] **Step 1: Write timeline functions with strict validation**

`timeline.ts` must reject non-16 manifests and missing/non-positive durations, calculate `durationInFrames = Math.max(1, Math.ceil(seconds * fps))`, and accumulate `startFrame` without overlaps:

```ts
import type {StoryScene, TimedScene} from "./types";

export const buildTimeline = (
  scenes: StoryScene[],
  durations: Record<string, number>,
  fps: number,
): TimedScene[] => {
  if (scenes.length !== 16) throw new Error(`Expected 16 scenes, got ${scenes.length}`);
  let startFrame = 0;
  return scenes.map((scene, index) => {
    if (scene.id !== index + 1) throw new Error(`Unexpected scene id ${scene.id}`);
    const seconds = durations[String(scene.id)];
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid duration for scene ${scene.id}`);
    const durationInFrames = Math.max(1, Math.ceil(seconds * fps));
    const timed = {...scene, startFrame, durationInFrames};
    startFrame += durationInFrames;
    return timed;
  });
};
```

- [ ] **Step 2: Implement the reusable scene visual**

Use `AbsoluteFill`, `Img`, `interpolate`, `Easing`, `useCurrentFrame`, and `useVideoConfig`. Set image `objectFit: "cover"`, scale from `1.035` to at most `1.07`, alternate horizontal drift by scene parity, fade in/out over roughly 8 frames, and add a dark top/bottom gradient for text contrast. Do not use CSS animations or keyframes.

- [ ] **Step 3: Implement safe-zone captions**

Select cues by local scene time `(frame / fps) * 1000` and render within this fixed safe zone:

```ts
{
  position: "absolute",
  left: 70,
  right: 230,
  top: 1260,
  color: "#FFD83A",
  fontFamily: "Segoe UI, Arial, sans-serif",
  fontSize: 56,
  fontWeight: 800,
  lineHeight: 1.16,
  textAlign: "center",
  textShadow: "-2px -2px 0 #111, 2px -2px 0 #111, -2px 2px 0 #111, 2px 2px 0 #111, 0 4px 6px rgba(0,0,0,0.8)",
}
```

- [ ] **Step 4: Implement title and final summary overlays**

Scene 1 displays the two-line white hook title near the top: `NỢ TIỀN KHÔNG TRẢ` / `LÀ GIEO NGHIỆP NGHÈO HÈN`. Scene 16 renders three editor-authored summary rows beside the generated icons. Do not render scene 17, CTA, book title, shopping-basket language, or engagement UI.

- [ ] **Step 5: Mount audio at the correct hierarchy**

At composition root, loop `audio/no-tien-khong-tra/bgm/no-tien-khong-tra-piano.wav` at volume `0.10`, fading during the last 24 frames. For each timed scene, create one `Sequence` at `startFrame`; mount image/captions, `vo_XX.wav` at volume 1, and that scene’s optional SFX inside the same sequence. Keep SFX at manifest volume and offset with nested `Sequence` only when `offsetFrames` is present.

- [ ] **Step 6: Export total frame computation**

```ts
const timeline30 = buildTimeline(SCENES, DURATIONS, 30);
export const computeNoTienKhongTraFrames = () =>
  timeline30.reduce((sum, scene) => sum + scene.durationInFrames, 0);
```

- [ ] **Step 7: Run TypeScript/ESLint and fix only relevant failures**

Run: `npx eslint src/no-tien-khong-tra && npx tsc --noEmit`

Expected: no errors in the new module. If pre-existing unrelated errors appear, record them and run targeted ESLint plus `npx tsc --noEmit --pretty false` to verify no error names the new files.

- [ ] **Step 8: Commit the composition module**

```powershell
git add -- src/no-tien-khong-tra
git commit -m "feat: build no tien khong tra composition"
```

---

### Task 5: Register the isolated vertical composition

**Files:**
- Modify: `src/Root.tsx`

**Interfaces:**
- Consumes: `NoTienKhongTraVideo` and `computeNoTienKhongTraFrames`.
- Produces: Remotion composition ID `NoTienKhongTraTikTok`.

- [ ] **Step 1: Confirm the composition does not exist**

Run: `rg -n "NoTienKhongTra" src/Root.tsx`

Expected: no matches.

- [ ] **Step 2: Add exactly one import and one composition**

```tsx
import {
  NoTienKhongTraVideo,
  computeNoTienKhongTraFrames,
} from "./no-tien-khong-tra/NoTienKhongTraVideo";
```

Register near the other vertical story compositions:

```tsx
<Composition
  id="NoTienKhongTraTikTok"
  component={NoTienKhongTraVideo}
  durationInFrames={computeNoTienKhongTraFrames()}
  fps={30}
  width={1080}
  height={1920}
/>
```

- [ ] **Step 3: List compositions**

Run: `npx remotion compositions src/index.ts`

Expected: `NoTienKhongTraTikTok` appears once with `1080x1920`, `30 fps`, and a positive duration.

- [ ] **Step 4: Commit registration**

```powershell
git add -- src/Root.tsx
git commit -m "feat: register debt story video"
```

---

### Task 6: Render, inspect, and verify the final MP4

**Files:**
- Create: `output/no-tien-khong-tra.mp4`
- Create: `output/no-tien-khong-tra-preview.png`

**Interfaces:**
- Consumes: composition `NoTienKhongTraTikTok`.
- Produces: verified MP4 and representative preview image.

- [ ] **Step 1: Render the composition**

Run:

```powershell
npx remotion render src/index.ts NoTienKhongTraTikTok output/no-tien-khong-tra.mp4 --codec h264 --audio-codec aac --crf 18
```

Expected: render completes without missing-asset or browser errors.

- [ ] **Step 2: Probe dimensions, frame rate, duration, and streams**

Run:

```powershell
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate:format=duration -of json output/no-tien-khong-tra.mp4
```

Expected: H.264 video stream at `1080x1920`, `30/1`; AAC audio stream; positive duration matching the computed Remotion duration within one frame.

- [ ] **Step 3: Check that the later half contains audible audio**

Run:

```powershell
ffmpeg -hide_banner -i output/no-tien-khong-tra.mp4 -af silencedetect=noise=-45dB:d=1.5 -f null NUL 2>&1 | Select-String 'silence_'
```

Expected: no silence interval spanning an entire scene in the latter half of the video. Short intentional gaps under 1.5 seconds are acceptable.

- [ ] **Step 4: Extract a representative preview**

Calculate the scene-16 start from the measured duration JSON and extract a frame 0.2 seconds into the scene:

```powershell
$debtDurations = Get-Content -LiteralPath 'src\no_tien_khong_tra_durations.json' -Raw | ConvertFrom-Json
$scene16Start = 0.2
1..15 | ForEach-Object { $scene16Start += [double]$debtDurations."$_" }
ffmpeg -y -ss $scene16Start -i output/no-tien-khong-tra.mp4 -frames:v 1 output/no-tien-khong-tra-preview.png
```

- [ ] **Step 5: Inspect representative frames**

Inspect frames from scene 1, scene 8 or 9, scene 12, and scene 16. Verify Vietnamese accents, title placement, caption safe zone, character clothing, scene order, final summary card, and absence of scene 17/book promotion/fake TikTok UI.

- [ ] **Step 6: Run final project checks**

Run:

```powershell
node scripts/validate-no-tien-khong-tra.mjs
npx eslint src/no-tien-khong-tra
npx remotion compositions src/index.ts
```

Expected: all three commands succeed and the target composition is listed exactly once.

- [ ] **Step 7: Commit final render artifacts only if repository policy retains outputs**

If other completed videos in `output/` are intentionally tracked, commit the two files; otherwise leave them untracked and report their absolute paths. Do not modify unrelated output artifacts.

---

## Self-Review Result

- Spec coverage: all 16 scenes, image style, measured TTS, caption safe zones, deterministic motion, scene-local VO, root BGM, restrained SFX, isolated registration, MP4 verification, and preview extraction are covered.
- Exclusions: scene 17, B1–B4, book copy, shopping-basket CTA, publishing, and unrelated workspace cleanup are explicitly excluded and validator-protected.
- Type consistency: `StoryScene`, `CaptionCue`, `TimedScene`, `buildTimeline`, `computeNoTienKhongTraFrames`, and `NoTienKhongTraVideo` use the same names across tasks.
- Placeholder scan: no deferred marker or unresolved command substitution remains.
