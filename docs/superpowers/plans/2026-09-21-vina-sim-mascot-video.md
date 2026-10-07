# Vina SIM Mascot Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install a reusable `vina-sim-mascot-video` skill plus a tested Remotion template that researches verified VinaPhone packages, chooses one of three adaptive script formats, and renders Bé Simi-led 9:16 videos for VNPT Hà Tĩnh.

**Architecture:** Keep research instructions and production utilities in a self-contained repository skill package under `.gemini/skills/vina-sim-mascot-video`. Keep render-time schemas, strategy rules, timeline helpers, components, and the composition under `src/vina-sim`; the skill generates a validated JSON project consumed by that composition. Pure decision logic and validation are covered by Vitest, Python production utilities by `unittest`, and the final composition by Remotion still/render smoke tests.

**Tech Stack:** TypeScript 5.9, React 19, Remotion 4.0.500, Zod 4.4.3, Vitest, Python 3, FFmpeg/ffprobe, Whisper, yt-dlp, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-21-vina-sim-mascot-video-design.md`

## Global Constraints

- Output is 1080×1920 at constant 30 fps.
- Typical duration is 25–35 seconds.
- Essential content must stay outside the bottom 15% and the right-side TikTok interaction rail.
- The inbox CTA is voice-only: “Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.”
- No visual inbox bar, fake button, or inbox subtitle may appear.
- Product price, cycle, core allowance, eligibility, and availability must be verified during the current run.
- A `conflict` or `incomplete` central sales claim stops final scripting and rendering.
- External assets require traceable source and permission information.
- Caption cues contain 4–7 words, except unavoidable one-to-three-word labels.
- Bé Simi is lively, honest, concise, and helpful; the voice uses clear standard Vietnamese.
- Render-critical motion uses Remotion frames, `spring`, `interpolate`, or deterministic math, never CSS keyframes.

---

## File Structure

```text
.gemini/skills/vina-sim-mascot-video/
  SKILL.md                              # Agent-facing end-to-end workflow
  assets/simi-reference.png            # User-selected visual source of truth
  references/research-and-verification.md
  references/script-formats.md
  references/media-sourcing.md
  references/remotion-production.md
  references/quality-gates.md
  scripts/generate_voice.py
  scripts/align_whisper_cues.py
  scripts/process_clip_cfr.py
  scripts/validate_delivery.py

src/vina-sim/
  model.ts                              # Zod schemas and inferred domain types
  strategy.ts                           # Script-format selection rules
  timeline.ts                           # Frame math, captions, and safe-zone constants
  sampleProject.ts                      # Verified synthetic render fixture
  VinaSimMascotVideo.tsx                # Main composition
  components/
    BrandFrame.tsx                      # Brand tag and safe layout shell
    MediaCard.tsx                       # Image/video/infographic renderer
    CaptionPill.tsx                     # Word-aligned short captions
    SimiMascot.tsx                      # Vector mascot and expression states
    SimiStage.tsx                       # Mascot placement and deterministic motion
  __tests__/
    model.test.ts
    strategy.test.ts
    timeline.test.ts
    SimiMascot.test.tsx

tools/
  vina_sim_pipeline.py                  # Validate, align, and invoke Remotion render

tests/
  test_vina_sim_tools.py                # Python utility tests
  test_vina_sim_skill.py                # Skill package integrity tests

public/vina-sim/
  audio/                                # Per-project voice and music inputs
  media/                                # Normalized licensed/official scene media
  preview-player.html                   # Local MP4 review player

docs/superpowers/
  specs/2026-09-21-vina-sim-mascot-video-design.md
  plans/2026-09-21-vina-sim-mascot-video.md
```

---

### Task 1: Add the Test Harness and Canonical Project Schema

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `src/vina-sim/model.ts`
- Create: `src/vina-sim/__tests__/model.test.ts`

**Interfaces:**
- Consumes: Zod 4.4.3 already installed in the project.
- Produces: `vinaSimProjectSchema`, `VinaSimProject`, `VinaSimScene`, `VerifiedPackage`, `SimiPose`, and `ScriptFormat`.

- [ ] **Step 1: Install Vitest and add stable test scripts**

Run:

```powershell
npm install --save-dev vitest
```

Edit `package.json` scripts to contain:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint src && tsc"
}
```

Add `.superpowers/` to `.gitignore` so visual-companion session files stay local.

- [ ] **Step 2: Write the failing schema tests**

Create `src/vina-sim/__tests__/model.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {vinaSimProjectSchema} from "../model";

const validProject = {
  product: {
    package: {
      code: "DEMO150",
      name: "Gói kiểm thử nội bộ",
      priceVnd: 150000,
      cycleDays: 30,
      dataAllowance: {amount: 4, unit: "GB", cadence: "daily"},
      appBenefits: [],
      additionalBenefits: [],
      eligibility: ["Thuê bao được hệ thống xác nhận đủ điều kiện"],
      coverageArea: ["Hà Tĩnh"],
      renewalRules: ["Tự động gia hạn khi tài khoản đủ tiền"],
    },
    verification: {
      status: "verified",
      checkedAt: "2026-09-21T03:00:00.000Z",
      evidence: [{
        sourceType: "user-official",
        title: "Phiếu gói kiểm thử nội bộ",
        checkedAt: "2026-09-21T03:00:00.000Z",
        supportedClaims: ["priceVnd", "cycleDays", "dataAllowance", "eligibility"],
      }],
      uncertainClaims: [],
    },
  },
  audience: {
    primarySegment: "Người dùng data cường độ cao",
    secondarySegments: [],
    painPoint: "Data hết giữa ngày",
    typicalUse: ["Học trực tuyến", "Xem video"],
    buyingObjection: "Không chắc thuê bao đủ điều kiện",
    reasonForMatch: "Dung lượng được cấp theo ngày",
  },
  creative: {
    format: "problem-solution",
    hook: "Họp giữa chừng mà data hết?",
    corePromise: "Kiểm tra đúng gói trước khi đăng ký",
    proofPoints: ["4 GB mỗi ngày", "Chu kỳ 30 ngày"],
    forbiddenClaims: ["Ai cũng đăng ký được"],
    targetDurationSeconds: 30,
  },
  scenes: [{
    id: "hook",
    narration: "Họp giữa chừng mà data hết thì xử lý sao?",
    media: {type: "infographic", src: "vina-sim/media/demo-hook.png"},
    pose: "surprised",
    durationSeconds: 4,
    cues: [{start: 0, end: 2.2, text: "HỌP GIỮA CHỪNG MÀ DATA HẾT"}],
  }],
  assets: [{
    sceneId: "hook",
    mediaType: "infographic",
    purpose: "Minh họa tình huống hết data",
    localPath: "public/vina-sim/media/demo-hook.png",
    licenseOrPermission: "Self-created",
  }],
  callToAction: {
    spokenText: "Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.",
    displayOnScreen: false,
  },
};

describe("vinaSimProjectSchema", () => {
  it("accepts a verified render project", () => {
    expect(vinaSimProjectSchema.parse(validProject).product.verification.status).toBe("verified");
  });

  it("rejects a render project with unresolved central facts", () => {
    const candidate = structuredClone(validProject);
    candidate.product.verification.status = "conflict";
    expect(() => vinaSimProjectSchema.parse(candidate)).toThrow(/verified/i);
  });

  it("rejects a visual inbox CTA", () => {
    const candidate = structuredClone(validProject);
    candidate.callToAction.displayOnScreen = true;
    expect(() => vinaSimProjectSchema.parse(candidate)).toThrow(/voice-only/i);
  });

  it("rejects captions containing the inbox CTA", () => {
    const candidate = structuredClone(validProject);
    candidate.scenes[0].cues[0].text = "INBOX TRỰC TIẾP VNPT HÀ TĨNH";
    expect(() => vinaSimProjectSchema.parse(candidate)).toThrow(/caption/i);
  });
});
```

- [ ] **Step 3: Run the schema tests and confirm the expected failure**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/model.test.ts
```

Expected: FAIL because `src/vina-sim/model.ts` does not exist.

- [ ] **Step 4: Implement the canonical schemas and inferred types**

Create `src/vina-sim/model.ts` with Zod schemas for every field in the test. The central object must include these refinements:

```ts
import {z} from "zod";

export const scriptFormatSchema = z.enum([
  "problem-solution",
  "offer-breakdown",
  "who-is-it-for",
]);

export const simiPoseSchema = z.enum([
  "neutral",
  "wave",
  "curious",
  "surprised",
  "explain",
  "point",
  "warn",
  "confident",
]);

const cueSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().min(1),
  highlightWords: z.array(z.string()).default([]),
}).refine((cue) => cue.end > cue.start, "Caption end must follow start");

const sceneSchema = z.object({
  id: z.string().min(1),
  narration: z.string().min(1),
  voiceSrc: z.string().min(1).optional(),
  media: z.object({
    type: z.enum(["official-image", "stock-video", "stock-image", "infographic"]),
    src: z.string().min(1),
  }),
  pose: simiPoseSchema,
  durationSeconds: z.number().positive(),
  cues: z.array(cueSchema),
});

export const vinaSimProjectSchema = z.object({
  product: z.object({
    package: z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      priceVnd: z.number().int().nonnegative(),
      cycleDays: z.number().int().positive(),
      dataAllowance: z.object({
        amount: z.number().nonnegative(),
        unit: z.enum(["MB", "GB"]),
        cadence: z.enum(["total", "daily", "monthly"]),
        rollover: z.boolean().optional(),
        afterCap: z.string().optional(),
      }),
      voiceAllowance: z.object({
        onNetMinutes: z.number().nonnegative().optional(),
        offNetMinutes: z.number().nonnegative().optional(),
        perCallLimitMinutes: z.number().nonnegative().optional(),
      }).optional(),
      smsAllowance: z.number().nonnegative().optional(),
      appBenefits: z.array(z.string()),
      additionalBenefits: z.array(z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        conditions: z.array(z.string()),
      })),
      registrationMethod: z.string().optional(),
      eligibility: z.array(z.string()).min(1),
      coverageArea: z.array(z.string()).min(1),
      renewalRules: z.array(z.string()),
    }),
    verification: z.object({
      status: z.enum(["verified", "conflict", "incomplete"]),
      checkedAt: z.string().datetime(),
      evidence: z.array(z.object({
        sourceType: z.enum(["official-web", "official-local", "official-app", "user-official"]),
        title: z.string().min(1),
        url: z.string().url().optional(),
        localPath: z.string().optional(),
        checkedAt: z.string().datetime(),
        supportedClaims: z.array(z.string()).min(1),
      })).min(1),
      uncertainClaims: z.array(z.string()),
    }),
  }),
  audience: z.object({
    primarySegment: z.string().min(1),
    secondarySegments: z.array(z.string()).max(2),
    painPoint: z.string().min(1),
    typicalUse: z.array(z.string()).min(1),
    buyingObjection: z.string().min(1),
    reasonForMatch: z.string().min(1),
  }),
  creative: z.object({
    format: scriptFormatSchema,
    hook: z.string().min(1),
    corePromise: z.string().min(1),
    proofPoints: z.array(z.string()).min(1),
    forbiddenClaims: z.array(z.string()),
    targetDurationSeconds: z.number().min(25).max(35),
  }),
  scenes: z.array(sceneSchema).min(1),
  assets: z.array(z.object({
    sceneId: z.string().min(1),
    mediaType: z.enum(["official-image", "stock-video", "stock-image", "infographic", "mascot"]),
    purpose: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    localPath: z.string().optional(),
    licenseOrPermission: z.string().min(1),
    downloadedAt: z.string().datetime().optional(),
  })),
  callToAction: z.object({
    spokenText: z.literal("Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký."),
    displayOnScreen: z.literal(false, {error: "Inbox CTA is voice-only"}),
  }),
}).superRefine((project, context) => {
  if (project.product.verification.status !== "verified") {
    context.addIssue({code: "custom", path: ["product", "verification", "status"], message: "Central package facts must be verified before rendering"});
  }
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [cueIndex, cue] of scene.cues.entries()) {
      if (/inbox|nhắn tin/i.test(cue.text)) {
        context.addIssue({code: "custom", path: ["scenes", sceneIndex, "cues", cueIndex], message: "Inbox CTA must not appear in captions"});
      }
    }
  }
});

export type VinaSimProject = z.infer<typeof vinaSimProjectSchema>;
export type VinaSimScene = VinaSimProject["scenes"][number];
export type VerifiedPackage = VinaSimProject["product"];
export type SimiPose = z.infer<typeof simiPoseSchema>;
export type ScriptFormat = z.infer<typeof scriptFormatSchema>;
```

- [ ] **Step 5: Run tests and static checks**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/model.test.ts
npm run lint
```

Expected: schema tests PASS; lint and TypeScript checks PASS.

- [ ] **Step 6: Commit the schema slice**

```powershell
git add package.json package-lock.json .gitignore src/vina-sim/model.ts src/vina-sim/__tests__/model.test.ts
git commit -m "feat: add Vina SIM project schema"
```

---

### Task 2: Implement Adaptive Script Selection

**Files:**
- Create: `src/vina-sim/strategy.ts`
- Create: `src/vina-sim/__tests__/strategy.test.ts`

**Interfaces:**
- Consumes: `ScriptFormat` from `src/vina-sim/model.ts`.
- Produces: `StrategySignals`, `selectScriptFormat(signals): ScriptFormat`, and `scoreDiscoveryCandidate(candidate): number`.

- [ ] **Step 1: Write failing strategy tests**

Create `src/vina-sim/__tests__/strategy.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {scoreDiscoveryCandidate, selectScriptFormat} from "../strategy";

describe("selectScriptFormat", () => {
  it("uses problem-solution for a dominant pain point", () => {
    expect(selectScriptFormat({problemClarity: 9, numericOfferStrength: 5, eligibilityComplexity: 2})).toBe("problem-solution");
  });

  it("uses offer-breakdown when verified numbers are strongest", () => {
    expect(selectScriptFormat({problemClarity: 4, numericOfferStrength: 9, eligibilityComplexity: 3})).toBe("offer-breakdown");
  });

  it("uses who-is-it-for for narrow eligibility and all ties", () => {
    expect(selectScriptFormat({problemClarity: 6, numericOfferStrength: 6, eligibilityComplexity: 8})).toBe("who-is-it-for");
    expect(selectScriptFormat({problemClarity: 7, numericOfferStrength: 7, eligibilityComplexity: 7})).toBe("who-is-it-for");
  });
});

describe("scoreDiscoveryCandidate", () => {
  it("applies the approved 100-point weighting", () => {
    expect(scoreDiscoveryCandidate({validity: 10, value: 8, audienceFit: 7, shortVideoClarity: 9, mediaAvailability: 8, novelty: 6})).toBe(83.5);
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/strategy.test.ts
```

Expected: FAIL because `strategy.ts` does not exist.

- [ ] **Step 3: Implement deterministic selection and scoring**

Create `src/vina-sim/strategy.ts`:

```ts
import type {ScriptFormat} from "./model";

export interface StrategySignals {
  problemClarity: number;
  numericOfferStrength: number;
  eligibilityComplexity: number;
}

export interface DiscoveryCandidateScores {
  validity: number;
  value: number;
  audienceFit: number;
  shortVideoClarity: number;
  mediaAvailability: number;
  novelty: number;
}

const clampTen = (value: number) => Math.max(0, Math.min(10, value));

export const selectScriptFormat = (signals: StrategySignals): ScriptFormat => {
  const entries: Array<[ScriptFormat, number]> = [
    ["problem-solution", clampTen(signals.problemClarity)],
    ["offer-breakdown", clampTen(signals.numericOfferStrength)],
    ["who-is-it-for", clampTen(signals.eligibilityComplexity)],
  ];
  const highest = Math.max(...entries.map(([, score]) => score));
  const winners = entries.filter(([, score]) => score === highest).map(([format]) => format);
  return winners.includes("who-is-it-for") ? "who-is-it-for" : winners[0];
};

export const scoreDiscoveryCandidate = (candidate: DiscoveryCandidateScores): number => {
  const score =
    clampTen(candidate.validity) * 2.5 +
    clampTen(candidate.value) * 2.5 +
    clampTen(candidate.audienceFit) * 2 +
    clampTen(candidate.shortVideoClarity) * 1.5 +
    clampTen(candidate.mediaAvailability) +
    clampTen(candidate.novelty) * 0.5;
  return Math.round(score * 10) / 10;
};
```

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run src/vina-sim/__tests__/strategy.test.ts
git add src/vina-sim/strategy.ts src/vina-sim/__tests__/strategy.test.ts
git commit -m "feat: add adaptive Vina SIM strategy rules"
```

Expected: all strategy tests PASS.

---

### Task 3: Add Timeline, Caption, and TikTok Safe-Zone Rules

**Files:**
- Create: `src/vina-sim/timeline.ts`
- Create: `src/vina-sim/__tests__/timeline.test.ts`

**Interfaces:**
- Consumes: `VinaSimScene` from `model.ts`.
- Produces: `FPS`, `SAFE_ZONES`, `buildTimeline`, `getActiveCue`, and `validateCaptionCue`.

- [ ] **Step 1: Write failing timeline tests**

Create `src/vina-sim/__tests__/timeline.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {buildTimeline, getActiveCue, SAFE_ZONES, validateCaptionCue} from "../timeline";

describe("timeline helpers", () => {
  it("converts scene seconds to contiguous 30 fps frames", () => {
    expect(buildTimeline([{id: "a", durationSeconds: 4}, {id: "b", durationSeconds: 6}])).toEqual([
      {id: "a", from: 0, durationInFrames: 120},
      {id: "b", from: 120, durationInFrames: 180},
    ]);
  });

  it("reserves the bottom 15 percent of 1920", () => {
    expect(SAFE_ZONES.bottomPx).toBe(288);
  });

  it("returns the current cue and excludes the end boundary", () => {
    const cues = [{start: 0, end: 1.5, text: "BỐN TỪ RÕ RÀNG"}];
    expect(getActiveCue(cues, 1.49)?.text).toBe("BỐN TỪ RÕ RÀNG");
    expect(getActiveCue(cues, 1.5)).toBeUndefined();
  });

  it("accepts four-to-seven words and rejects visual inbox copy", () => {
    expect(validateCaptionCue("GÓI NÀY HỢP VỚI AI")).toEqual([]);
    expect(validateCaptionCue("INBOX TRỰC TIẾP VNPT HÀ TĨNH")).toContain("CTA must remain voice-only");
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/timeline.test.ts
```

Expected: FAIL because `timeline.ts` does not exist.

- [ ] **Step 3: Implement frame math and caption checks**

Create `src/vina-sim/timeline.ts`:

```ts
export const FPS = 30;
export const SAFE_ZONES = {
  bottomPx: Math.round(1920 * 0.15),
  rightPx: 150,
  topPx: 96,
  leftPx: 64,
} as const;

export const buildTimeline = (scenes: Array<{id: string; durationSeconds: number}>) => {
  let cursor = 0;
  return scenes.map((scene) => {
    const durationInFrames = Math.round(scene.durationSeconds * FPS);
    const item = {id: scene.id, from: cursor, durationInFrames};
    cursor += durationInFrames;
    return item;
  });
};

export const getActiveCue = <T extends {start: number; end: number}>(cues: T[], seconds: number) =>
  cues.find((cue) => seconds >= cue.start && seconds < cue.end);

export const validateCaptionCue = (text: string): string[] => {
  const errors: string[] = [];
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 7) errors.push("Caption must contain at most seven words");
  if (/inbox|nhắn tin/i.test(text)) errors.push("CTA must remain voice-only");
  return errors;
};
```

- [ ] **Step 4: Run timeline tests and commit**

```powershell
npx vitest run src/vina-sim/__tests__/timeline.test.ts
git add src/vina-sim/timeline.ts src/vina-sim/__tests__/timeline.test.ts
git commit -m "feat: add Vina SIM timeline safety rules"
```

Expected: all timeline tests PASS.

---

### Task 4: Persist and Rebuild the User-Selected Bé Simi Mascot

**Files:**
- Create: `.gemini/skills/vina-sim-mascot-video/assets/simi-reference.png`
- Create: `src/vina-sim/components/SimiMascot.tsx`
- Create: `src/vina-sim/__tests__/SimiMascot.test.tsx`

**Interfaces:**
- Consumes: `SimiPose` from `model.ts` and the user-selected reference image.
- Produces: `<SimiMascot pose frame />`, a deterministic vector mascot with eight expression states.

- [ ] **Step 1: Persist the source-of-truth image**

Copy the user-selected image without modifying it:

```powershell
New-Item -ItemType Directory -Force '.gemini\skills\vina-sim-mascot-video\assets'
Copy-Item -LiteralPath 'C:\Users\ADMIN\AppData\Local\Temp\codex-clipboard-7ae25216-d81f-4664-8d69-7dc343af583a.png' -Destination '.gemini\skills\vina-sim-mascot-video\assets\simi-reference.png'
```

Verify that the copy is a readable PNG and retain it only as a design reference; embedded title and CTA text must not enter the rendered mascot.

- [ ] **Step 2: Write the failing mascot markup test**

Create `src/vina-sim/__tests__/SimiMascot.test.tsx`:

```tsx
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {SimiMascot} from "../components/SimiMascot";

describe("SimiMascot", () => {
  it("renders a vector mascot with the selected pose", () => {
    const html = renderToStaticMarkup(<SimiMascot pose="wave" frame={20} />);
    expect(html).toContain("data-mascot=\"be-simi\"");
    expect(html).toContain("data-pose=\"wave\"");
    expect(html).toContain("#f58220");
    expect(html).not.toContain("<img");
  });
});
```

- [ ] **Step 3: Run the mascot test and confirm failure**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/SimiMascot.test.tsx
```

Expected: FAIL because `SimiMascot.tsx` does not exist.

- [ ] **Step 4: Implement Bé Simi as deterministic SVG**

Create `src/vina-sim/components/SimiMascot.tsx`. Use the selected blue SIM silhouette, folded top-right corner, orange rounded chip, dark blue eyes, white smile, blue limbs, and orange hands. Pose changes must alter only deterministic transforms and facial paths:

```tsx
import React from "react";
import type {SimiPose} from "../model";

const POSE_STYLE: Record<SimiPose, {lean: number; leftArm: number; rightArm: number; browY: number}> = {
  neutral: {lean: 0, leftArm: 0, rightArm: 0, browY: 0},
  wave: {lean: -2, leftArm: 0, rightArm: -18, browY: 0},
  curious: {lean: 4, leftArm: 8, rightArm: -4, browY: -4},
  surprised: {lean: 0, leftArm: -8, rightArm: 8, browY: -10},
  explain: {lean: -3, leftArm: 10, rightArm: -10, browY: 0},
  point: {lean: -5, leftArm: 0, rightArm: -28, browY: -2},
  warn: {lean: 0, leftArm: -12, rightArm: 12, browY: 6},
  confident: {lean: 0, leftArm: 14, rightArm: -14, browY: -3},
};

export const SimiMascot: React.FC<{pose: SimiPose; frame: number}> = ({pose, frame}) => {
  const style = POSE_STYLE[pose];
  const breathe = Math.sin(frame * 0.08) * 4;
  const wave = pose === "wave" ? Math.sin(frame * 0.35) * 18 : 0;
  const surprised = pose === "surprised";
  const warning = pose === "warn";

  return (
    <svg data-mascot="be-simi" data-pose={pose} viewBox="0 0 360 410" style={{overflow: "visible"}}>
      <defs>
        <linearGradient id="simi-body" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#1ab2d6" />
          <stop offset="1" stopColor="#0872b8" />
        </linearGradient>
      </defs>
      <g transform={`translate(180 ${breathe}) rotate(${style.lean}) translate(-180 0)`}>
        <path d="M102 53h105l64 65v208q0 43-43 43H102q-43 0-43-43V96q0-43 43-43Z" fill="url(#simi-body)" stroke="#075f98" strokeWidth="9" />
        <path d="M207 53v64h64" fill="#e9faff" stroke="#075f98" strokeWidth="9" />
        <rect x="104" y="121" width="121" height="92" rx="20" fill="#ffd27c" stroke="#f58220" strokeWidth="8" />
        <path d="M104 166h121m-61-45v92" stroke="#f58220" strokeWidth="7" />
        <ellipse cx="127" cy="261" rx={surprised ? 16 : 14} ry={surprised ? 18 : 14} fill="#10374c" />
        <ellipse cx="207" cy="261" rx={surprised ? 16 : 14} ry={surprised ? 18 : 14} fill="#10374c" />
        <circle cx="132" cy="256" r="5" fill="white" />
        <circle cx="212" cy="256" r="5" fill="white" />
        {surprised ? <circle cx="168" cy="302" r="13" fill="#fff" /> : <path d={warning ? "M140 310q28-20 56 0" : "M139 299q29 28 58 0"} fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" />}
        <g transform={`rotate(${style.leftArm} 60 236)`}><path d="M60 236Q15 250 27 307" fill="none" stroke="#0b91c5" strokeWidth="24" strokeLinecap="round" /></g>
        <g transform={`rotate(${style.rightArm + wave} 271 237)`}>
          <path d="M271 237q49 13 45 70" fill="none" stroke="#0b91c5" strokeWidth="24" strokeLinecap="round" />
          <circle cx="316" cy="314" r="17" fill="#f58220" />
        </g>
        <circle cx="27" cy="314" r="17" fill="#f58220" />
        <path d="M121 369v31m91-31v31" stroke="#075f98" strokeWidth="25" strokeLinecap="round" />
      </g>
    </svg>
  );
};
```

Render two short eyebrow paths at `y = 231 + style.browY`; use a downward curve only for `warn`, a round open mouth only for `surprised`, and the approved white smile for the other six poses. These exact pose values complete all eight states without changing the core silhouette or palette.

- [ ] **Step 5: Run the mascot test and inspect all poses**

Run:

```powershell
npx vitest run src/vina-sim/__tests__/SimiMascot.test.tsx
npm run lint
```

Expected: tests and static checks PASS. Use a Remotion preview scene in Task 5 to visually inspect every pose.

- [ ] **Step 6: Commit the mascot slice**

```powershell
git add .gemini/skills/vina-sim-mascot-video/assets/simi-reference.png src/vina-sim/components/SimiMascot.tsx src/vina-sim/__tests__/SimiMascot.test.tsx
git commit -m "feat: add Bé Simi vector mascot"
```

---

### Task 5: Build and Register the Remotion Composition

**Files:**
- Create: `src/vina-sim/components/BrandFrame.tsx`
- Create: `src/vina-sim/components/MediaCard.tsx`
- Create: `src/vina-sim/components/CaptionPill.tsx`
- Create: `src/vina-sim/components/SimiStage.tsx`
- Create: `src/vina-sim/sampleProject.ts`
- Create: `src/vina-sim/VinaSimMascotVideo.tsx`
- Create: `public/vina-sim/preview-player.html`
- Modify: `src/Root.tsx:42-55`
- Modify: `src/Root.tsx:492-500`
- Test: `src/vina-sim/__tests__/timeline.test.ts`

**Interfaces:**
- Consumes: `VinaSimProject`, `buildTimeline`, `getActiveCue`, `SAFE_ZONES`, and `SimiMascot`.
- Produces: `VinaSimMascotVideo`, `computeVinaSimFrames(project): number`, and composition ID `VinaSimMascotVideo`.

- [ ] **Step 1: Add a failing total-frame assertion**

Append to `src/vina-sim/__tests__/timeline.test.ts`:

```ts
import {computeTotalFrames} from "../timeline";

it("computes the complete frame count", () => {
  expect(computeTotalFrames([{id: "a", durationSeconds: 4}, {id: "b", durationSeconds: 6}])).toBe(300);
});
```

Run:

```powershell
npx vitest run src/vina-sim/__tests__/timeline.test.ts
```

Expected: FAIL because `computeTotalFrames` is not exported.

- [ ] **Step 2: Add total-frame computation**

Append to `src/vina-sim/timeline.ts`:

```ts
export const computeTotalFrames = (scenes: Array<{id: string; durationSeconds: number}>) =>
  buildTimeline(scenes).reduce((total, item) => total + item.durationInFrames, 0);
```

Run the timeline test again and expect PASS.

- [ ] **Step 3: Create the verified synthetic render fixture**

Create `src/vina-sim/sampleProject.ts` with a complete synthetic project. Keep the real package code `U1500` out of this fixture so automated tests never publish stale commercial facts:

```ts
import {vinaSimProjectSchema} from "./model";

export const SAMPLE_VINA_SIM_PROJECT = vinaSimProjectSchema.parse({
  product: {
    package: {
      code: "DEMO150",
      name: "Gói kiểm thử nội bộ",
      priceVnd: 150000,
      cycleDays: 30,
      dataAllowance: {amount: 4, unit: "GB", cadence: "daily"},
      appBenefits: [],
      additionalBenefits: [],
      eligibility: ["Thuê bao được hệ thống xác nhận đủ điều kiện"],
      coverageArea: ["Hà Tĩnh"],
      renewalRules: ["Tự động gia hạn khi tài khoản đủ tiền"],
    },
    verification: {
      status: "verified",
      checkedAt: "2026-09-21T03:00:00.000Z",
      evidence: [{sourceType: "user-official", title: "Phiếu dữ liệu kiểm thử", checkedAt: "2026-09-21T03:00:00.000Z", supportedClaims: ["priceVnd", "cycleDays", "dataAllowance", "eligibility"]}],
      uncertainClaims: [],
    },
  },
  audience: {
    primarySegment: "Người dùng data cường độ cao",
    secondarySegments: [],
    painPoint: "Data hết giữa ngày",
    typicalUse: ["Học trực tuyến", "Xem video"],
    buyingObjection: "Không chắc thuê bao đủ điều kiện",
    reasonForMatch: "Dung lượng được cấp theo ngày",
  },
  creative: {
    format: "problem-solution",
    hook: "Họp giữa chừng mà data hết?",
    corePromise: "Kiểm tra đúng gói trước khi đăng ký",
    proofPoints: ["4 GB mỗi ngày", "Chu kỳ 30 ngày"],
    forbiddenClaims: ["Ai cũng đăng ký được"],
    targetDurationSeconds: 30,
  },
  scenes: [
    {id: "hook", narration: "Họp giữa chừng mà data hết thì xử lý sao?", voiceSrc: "vina-sim/audio/vo-hook.mp3", media: {type: "infographic", src: "HỌP GIỮA CHỪNG • DATA HẾT"}, pose: "surprised", durationSeconds: 5, cues: [{start: 0, end: 2.5, text: "HỌP GIỮA CHỪNG MÀ DATA HẾT"}]},
    {id: "benefit", narration: "Bé Simi sẽ kiểm tra gói phù hợp đúng nhu cầu của bạn.", voiceSrc: "vina-sim/audio/vo-benefit.mp3", media: {type: "infographic", src: "4 GB / NGÀY • 30 NGÀY"}, pose: "explain", durationSeconds: 18, cues: [{start: 0, end: 3, text: "KIỂM TRA GÓI ĐÚNG NHU CẦU"}, {start: 3, end: 6, text: "BỐN GB MỖI NGÀY"}]},
    {id: "close", narration: "Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.", voiceSrc: "vina-sim/audio/vo-close.mp3", media: {type: "infographic", src: "VNPT HÀ TĨNH"}, pose: "wave", durationSeconds: 7, cues: []},
  ],
  assets: [
    {sceneId: "hook", mediaType: "infographic", purpose: "Minh họa tình huống", localPath: "inline:hook", licenseOrPermission: "Self-created"},
    {sceneId: "benefit", mediaType: "infographic", purpose: "Minh họa quyền lợi", localPath: "inline:benefit", licenseOrPermission: "Self-created"},
    {sceneId: "close", mediaType: "infographic", purpose: "Brand resolve", localPath: "inline:close", licenseOrPermission: "Self-created"},
  ],
  callToAction: {spokenText: "Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.", displayOnScreen: false},
});
```

- [ ] **Step 4: Implement the four focused presentation components**

Implement the files with these exact responsibilities:

```tsx
// BrandFrame.tsx
import React from "react";
import {AbsoluteFill} from "remotion";

export const BrandFrame: React.FC<React.PropsWithChildren> = ({children}) => (
  <AbsoluteFill style={{background: "linear-gradient(160deg,#eefaff 0%,#fff 58%,#fff4e7 100%)", padding: "96px 150px 288px 64px"}}>
    <div style={{position: "absolute", top: 54, left: 64, color: "#0879bd", fontWeight: 900}}>● VNPT HÀ TĨNH</div>
    {children}
  </AbsoluteFill>
);
```

```tsx
// CaptionPill.tsx
import React from "react";

export const CaptionPill: React.FC<{text: string; highlights?: string[]}> = ({text, highlights = []}) => (
  <div style={{position: "absolute", top: 860, left: 72, right: 222, borderRadius: 30, padding: "22px 30px", background: "rgba(6,49,75,.94)", color: "white", fontSize: 48, fontWeight: 900, textAlign: "center"}}>
    {text.split(/(\s+)/).map((part, index) => <span key={`${part}-${index}`} style={{color: highlights.some((word) => part.toLocaleUpperCase("vi").includes(word.toLocaleUpperCase("vi"))) ? "#ffd166" : "inherit"}}>{part}</span>)}
  </div>
);
```

```tsx
// MediaCard.tsx
import React from "react";
import {Img, OffthreadVideo, staticFile} from "remotion";
import type {VinaSimProject} from "../model";

type Media = VinaSimProject["scenes"][number]["media"];

export const MediaCard: React.FC<{media: Media}> = ({media}) => {
  const shell: React.CSSProperties = {position: "absolute", top: 150, left: 64, width: 866, height: 650, overflow: "hidden", borderRadius: 32, border: "4px solid white", boxShadow: "0 20px 60px rgba(12,60,80,.2)"};
  if (media.type === "infographic") {
    return <div style={{...shell, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#0879bd,#19a9d1)", color: "white", fontSize: 64, fontWeight: 900, textAlign: "center", padding: 48}}>{media.src}</div>;
  }
  if (media.type === "stock-video") {
    return <div style={shell}><OffthreadVideo src={staticFile(media.src)} muted style={{width: "100%", height: "100%", objectFit: "cover"}} /></div>;
  }
  return <div style={shell}><Img src={staticFile(media.src)} style={{width: "100%", height: "100%", objectFit: "cover"}} /></div>;
};
```

```tsx
// SimiStage.tsx
import React from "react";
import {spring, useVideoConfig} from "remotion";
import type {SimiPose} from "../model";
import {SimiMascot} from "./SimiMascot";

export const SimiStage: React.FC<{pose: SimiPose; frame: number}> = ({pose, frame}) => {
  const {fps} = useVideoConfig();
  const entrance = spring({fps, frame, config: {damping: 16, stiffness: 120}});
  return (
    <div style={{position: "absolute", left: 110, bottom: 315, width: 520, height: 540, transform: `translateY(${(1 - entrance) * 120}px) scale(${0.9 + entrance * 0.1})`, transformOrigin: "bottom center"}}>
      <SimiMascot pose={pose} frame={frame} />
    </div>
  );
};
```

- [ ] **Step 5: Implement the main composition**

Create `src/vina-sim/VinaSimMascotVideo.tsx`:

```tsx
import React from "react";
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from "remotion";
import type {VinaSimProject} from "./model";
import {buildTimeline, computeTotalFrames, FPS, getActiveCue} from "./timeline";
import {BrandFrame} from "./components/BrandFrame";
import {CaptionPill} from "./components/CaptionPill";
import {MediaCard} from "./components/MediaCard";
import {SimiStage} from "./components/SimiStage";

export const computeVinaSimFrames = (project: VinaSimProject) => computeTotalFrames(project.scenes);

const SceneView: React.FC<{scene: VinaSimProject["scenes"][number]}> = ({scene}) => {
  const frame = useCurrentFrame();
  const seconds = frame / FPS;
  const cue = getActiveCue(scene.cues, seconds);
  return (
    <BrandFrame>
      <MediaCard media={scene.media} />
      {cue ? <CaptionPill text={cue.text} highlights={cue.highlightWords} /> : null}
      <SimiStage pose={scene.pose} frame={frame} />
      {scene.voiceSrc ? <Audio src={staticFile(scene.voiceSrc)} /> : null}
    </BrandFrame>
  );
};

export const VinaSimMascotVideo: React.FC<{project: VinaSimProject}> = ({project}) => {
  const timeline = buildTimeline(project.scenes);
  return (
    <AbsoluteFill>
      {project.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={timeline[index].from} durationInFrames={timeline[index].durationInFrames} premountFor={30}>
          <SceneView scene={scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Register the composition**

Import the new component and sample project near the existing Capy imports in `src/Root.tsx`, then add:

```tsx
<Composition
  id="VinaSimMascotVideo"
  component={VinaSimMascotVideo}
  durationInFrames={computeVinaSimFrames(SAMPLE_VINA_SIM_PROJECT)}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{project: SAMPLE_VINA_SIM_PROJECT}}
/>
```

- [ ] **Step 7: Add the browser-playable review page**

Create `public/vina-sim/preview-player.html` as a standalone local review page:

```html
<!doctype html>
<html lang="vi">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>VNPT Hà Tĩnh • Bé Simi Preview</title>
<style>
  body{margin:0;background:#eaf7fc;color:#083a56;font:16px system-ui;display:grid;place-items:center;min-height:100vh}
  main{display:grid;gap:16px;justify-items:center;padding:24px}video{height:min(78vh,760px);aspect-ratio:9/16;background:#102d40;border-radius:24px;box-shadow:0 18px 50px #0b557733}
  label{background:#f58220;color:#fff;padding:12px 18px;border-radius:999px;font-weight:800;cursor:pointer}input{display:none}
</style>
<main>
  <h1>Bé Simi • Video Preview</h1>
  <video id="preview" controls playsinline></video>
  <label>Chọn MP4 để xem<input id="file" type="file" accept="video/mp4" /></label>
</main>
<script>
  const input = document.querySelector('#file');
  const video = document.querySelector('#preview');
  input.addEventListener('change', () => {
    if (input.files[0]) video.src = URL.createObjectURL(input.files[0]);
  });
</script>
</html>
```

- [ ] **Step 8: Run tests and Remotion smoke checks**

Run:

```powershell
npm test
npm run lint
npx remotion compositions | Select-String 'VinaSimMascotVideo'
npx remotion still VinaSimMascotVideo out/vina-sim-layout-check.png --frame=450
Start-Process 'public\vina-sim\preview-player.html'
```

Expected: tests and lint PASS; the composition is listed; the still keeps all essential elements above the bottom 288 px and away from the right interaction rail; no visible inbox CTA exists.

- [ ] **Step 9: Commit the render slice**

```powershell
git add src/vina-sim src/Root.tsx public/vina-sim/preview-player.html
git commit -m "feat: add Vina SIM mascot composition"
```

---

### Task 6: Add Production Utilities and Delivery Validation

**Files:**
- Create: `.gemini/skills/vina-sim-mascot-video/scripts/generate_voice.py`
- Create: `.gemini/skills/vina-sim-mascot-video/scripts/align_whisper_cues.py`
- Create: `.gemini/skills/vina-sim-mascot-video/scripts/process_clip_cfr.py`
- Create: `.gemini/skills/vina-sim-mascot-video/scripts/validate_delivery.py`
- Create: `tools/vina_sim_pipeline.py`
- Create: `tests/test_vina_sim_tools.py`

**Interfaces:**
- Consumes: a validated project JSON, narration text, licensed/official source media, FFmpeg, and Remotion composition `VinaSimMascotVideo`.
- Produces: Vietnamese voice files, 4–7-word caption cues, normalized CFR 30 fps media, validation JSON, and a rendered MP4.

- [ ] **Step 1: Write failing Python tests for caption grouping and manifest validation**

Create `tests/test_vina_sim_tools.py`:

```py
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class VinaSimToolsTest(unittest.TestCase):
    def test_voice_rejects_blank_text(self):
        module = load_module("voice", ROOT / ".gemini/skills/vina-sim-mascot-video/scripts/generate_voice.py")
        with self.assertRaises(ValueError):
            module.validate_text("   ")

    def test_caption_groups_have_at_most_seven_words(self):
        module = load_module("align", ROOT / ".gemini/skills/vina-sim-mascot-video/scripts/align_whisper_cues.py")
        words = [{"word": word, "start": index * .2, "end": index * .2 + .18} for index, word in enumerate("một hai ba bốn năm sáu bảy tám chín".split())]
        cues = module.group_words_into_cues(words, max_words=7)
        self.assertTrue(all(len(cue["text"].split()) <= 7 for cue in cues))

    def test_delivery_rejects_unlicensed_assets(self):
        module = load_module("validate", ROOT / ".gemini/skills/vina-sim-mascot-video/scripts/validate_delivery.py")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "asset-manifest.json"
            path.write_text(json.dumps([{"sceneId": "hook", "purpose": "demo", "licenseOrPermission": ""}]), encoding="utf-8")
            self.assertIn("licenseOrPermission", module.validate_asset_manifest(path))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the utility tests and confirm failure**

Run:

```powershell
python -m unittest tests.test_vina_sim_tools -v
```

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Add the standard-Vietnamese voice generator**

Install the speech dependency:

```powershell
python -m pip install edge-tts
```

Create `generate_voice.py`:

```py
import argparse
import asyncio
from pathlib import Path

DEFAULT_VOICE = "vi-VN-HoaiMyNeural"

def validate_text(text: str):
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Narration text cannot be blank")
    return cleaned

async def generate(text: str, output: Path, voice: str = DEFAULT_VOICE):
    import edge_tts
    output.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(validate_text(text), voice=voice, rate="+0%", volume="+0%")
    await communicate.save(str(output))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()
    asyncio.run(generate(args.text, args.output, args.voice))
```

- [ ] **Step 4: Adapt the Whisper and CFR scripts**

Use the existing `drama-mascot-video` scripts as the baseline, with these required changes:

- `align_whisper_cues.py`: default `max_words=7`, preserve Vietnamese punctuation, import `whisper` inside `align_audio` so grouping tests do not require the model package, reject any generated cue containing `inbox` or `nhắn tin`, and return non-zero exit status on that violation.
- `process_clip_cfr.py`: accept local files by default, retain `--url` only for authorized official sources, normalize to 1000×730 CFR 30 fps, H.264 CRF 17, pixel format `yuv420p`, GOP 15, and strip audio.
- Both scripts must use `subprocess.run(..., check=True)` so failures stop the pipeline.

- [ ] **Step 5: Implement delivery validation**

Create `validate_delivery.py` with callable functions and a CLI:

```py
import argparse
import json
from pathlib import Path

REQUIRED_OUTPUTS = (
    "package-facts.json",
    "audience-strategy.json",
    "creative-strategy.json",
    "script.json",
    "asset-manifest.json",
    "captions.json",
)

def validate_asset_manifest(path: Path):
    errors = []
    assets = json.loads(path.read_text(encoding="utf-8"))
    for index, asset in enumerate(assets):
        if not asset.get("licenseOrPermission", "").strip():
            errors.append(f"assets[{index}].licenseOrPermission")
        if not asset.get("sourceUrl") and not asset.get("localPath"):
            errors.append(f"assets[{index}].source")
    return errors

def validate_delivery(directory: Path):
    errors = [name for name in REQUIRED_OUTPUTS if not (directory / name).is_file()]
    manifest = directory / "asset-manifest.json"
    if manifest.is_file():
        errors.extend(validate_asset_manifest(manifest))
    return errors

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    problems = validate_delivery(args.directory)
    print(json.dumps({"ok": not problems, "errors": problems}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if problems else 0)
```

- [ ] **Step 6: Implement the orchestration CLI**

Create `tools/vina_sim_pipeline.py` with explicit subcommands:

```text
validate  --delivery <directory>
voice     --text <narration> --output <audio.mp3>
align     --audio <wav> --output <captions.json>
normalize --input <video> --output <video>
render    --project <project.json> --output <video.mp4>
```

`render` must run delivery validation first, then invoke:

```powershell
npx.cmd remotion render VinaSimMascotVideo <output> --props=<project.json> --concurrency=4
```

The CLI must propagate every subprocess exit code and must not delete source media.

- [ ] **Step 7: Run tests and commit**

```powershell
python -m unittest tests.test_vina_sim_tools -v
git add .gemini/skills/vina-sim-mascot-video/scripts tools/vina_sim_pipeline.py tests/test_vina_sim_tools.py
git commit -m "feat: add Vina SIM production utilities"
```

Expected: Python tests PASS.

---

### Task 7: Author and Verify the Reusable Skill Package

**Files:**
- Create: `.gemini/skills/vina-sim-mascot-video/SKILL.md`
- Create: `.gemini/skills/vina-sim-mascot-video/references/research-and-verification.md`
- Create: `.gemini/skills/vina-sim-mascot-video/references/script-formats.md`
- Create: `.gemini/skills/vina-sim-mascot-video/references/media-sourcing.md`
- Create: `.gemini/skills/vina-sim-mascot-video/references/remotion-production.md`
- Create: `.gemini/skills/vina-sim-mascot-video/references/quality-gates.md`
- Create: `tests/test_vina_sim_skill.py`

**Interfaces:**
- Consumes: the approved design, production scripts, Bé Simi reference, and Remotion composition contract.
- Produces: a self-contained skill that can be copied to `C:\Users\ADMIN\.gemini\config\skills\vina-sim-mascot-video`.

- [ ] **Step 1: Write the failing package-integrity test**

Create `tests/test_vina_sim_skill.py`:

```py
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / ".gemini/skills/vina-sim-mascot-video"

class VinaSimSkillPackageTest(unittest.TestCase):
    def test_required_files_exist_and_are_linked(self):
        skill_text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("name: vina-sim-mascot-video", skill_text)
        required = [
            "references/research-and-verification.md",
            "references/script-formats.md",
            "references/media-sourcing.md",
            "references/remotion-production.md",
            "references/quality-gates.md",
            "scripts/generate_voice.py",
            "scripts/align_whisper_cues.py",
            "scripts/process_clip_cfr.py",
            "scripts/validate_delivery.py",
            "assets/simi-reference.png",
        ]
        for relative in required:
            self.assertTrue((SKILL / relative).is_file(), relative)
            self.assertIn(relative, skill_text)

    def test_skill_requires_verified_facts_and_voice_only_cta(self):
        skill_text = (SKILL / "SKILL.md").read_text(encoding="utf-8").lower()
        self.assertIn("conflict", skill_text)
        self.assertIn("incomplete", skill_text)
        self.assertIn("voice-only", skill_text)
        self.assertNotIn("cta bar", skill_text)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the package test and confirm failure**

Run:

```powershell
python -m unittest tests.test_vina_sim_skill -v
```

Expected: FAIL because `SKILL.md` and reference documents do not exist.

- [ ] **Step 3: Write `SKILL.md` as the routing workflow**

The file must start with:

```yaml
---
name: vina-sim-mascot-video
description: >-
  Research, script, source, produce, and verify Vietnamese 9:16 VinaPhone SIM package videos for VNPT Hà Tĩnh with the Bé Simi mascot. Use when the user provides a package such as U1500, asks for a current attractive package, requests a SIM sales video, or needs a verified package comparison and Remotion render.
---
```

The body must route the agent through these ordered gates:

1. Classify `specific_package`, `discover_package`, or `compare_packages`.
2. Read `references/research-and-verification.md` and build `package-facts.json`.
3. Stop if verification is `conflict` or `incomplete` for a central claim.
4. Infer one primary audience and score the three formats using `references/script-formats.md`.
5. Plan rights-safe media using `references/media-sourcing.md` and produce `asset-manifest.json`.
6. Write narration in Bé Simi’s approved personality and voice.
7. Follow `references/remotion-production.md` and use `scripts/generate_voice.py` for audio, captions, normalized media, preview, and render.
8. Run `scripts/validate_delivery.py` and every gate in `references/quality-gates.md`.
9. Deliver research JSON, strategy JSON, script JSON, manifest, captions, MP4, preview, and validation report.

`SKILL.md` must explicitly say that the inbox CTA is spoken only, has no caption cue, and is never displayed as a bar or button.

- [ ] **Step 4: Write the five focused reference documents**

Use these exact responsibilities:

- `research-and-verification.md`: official-source priority, same-run verification, evidence schema, conflict handling, discovery scoring, and prohibition on unsupported “hot” claims.
- `script-formats.md`: the three approved timelines, selection scores, audience reasoning, Bé Simi voice, claim wording, and the exact spoken CTA.
- `media-sourcing.md`: approved official/user/stock/self-created sources, rights manifest, video-versus-still matrix, privacy, watermark, resolution, and download constraints.
- `remotion-production.md`: JSON handoff, Edge TTS with a clear standard-Vietnamese voice, Whisper alignment, 4–7-word cues, CFR processing, composition ID, preview, render commands, audio target, and TikTok safe zones.
- `quality-gates.md`: fact, claim, asset, brand, layout, audio, caption, and technical checks with explicit stop conditions.

Each reference must include commands and field names used by the production scripts; it must not redefine conflicting names.

- [ ] **Step 5: Run skill and utility tests**

```powershell
python -m unittest tests.test_vina_sim_skill tests.test_vina_sim_tools -v
npm test
npm run lint
```

Expected: all Python and TypeScript tests PASS.

- [ ] **Step 6: Commit the skill package**

```powershell
git add .gemini/skills/vina-sim-mascot-video tests/test_vina_sim_skill.py
git commit -m "feat: add Vina SIM mascot production skill"
```

---

### Task 8: Run End-to-End Verification and Install the Skill

**Files:**
- Verify: `src/vina-sim/sampleProject.ts`
- Verify: `.gemini/skills/vina-sim-mascot-video/`
- Create locally: `out/vina-sim-sample.mp4`
- Install locally: `C:\Users\ADMIN\.gemini\config\skills\vina-sim-mascot-video\`

**Interfaces:**
- Consumes: every artifact from Tasks 1–7.
- Produces: a verified sample render and an installed personal Gemini skill.

- [ ] **Step 1: Run the complete automated test suite**

```powershell
npm test
npm run lint
python -m unittest tests.test_vina_sim_tools tests.test_vina_sim_skill -v
```

Expected: every test and static check PASS.

- [ ] **Step 2: Generate the synthetic sample voice tracks**

```powershell
python .gemini\skills\vina-sim-mascot-video\scripts\generate_voice.py --text 'Họp giữa chừng mà data hết thì xử lý sao?' --output public\vina-sim\audio\vo-hook.mp3
python .gemini\skills\vina-sim-mascot-video\scripts\generate_voice.py --text 'Bé Simi sẽ kiểm tra gói phù hợp đúng nhu cầu của bạn.' --output public\vina-sim\audio\vo-benefit.mp3
python .gemini\skills\vina-sim-mascot-video\scripts\generate_voice.py --text 'Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.' --output public\vina-sim\audio\vo-close.mp3
```

Expected: three non-empty MP3 files using the configured standard-Vietnamese voice.

- [ ] **Step 3: Render the synthetic 30-second sample**

```powershell
npx remotion render VinaSimMascotVideo out/vina-sim-sample.mp4 --concurrency=4
```

Expected: a playable 1080×1920, 30 fps MP4 with Bé Simi, no visual inbox CTA, and no essential content in the bottom 15% or right interaction rail.

- [ ] **Step 4: Inspect media properties and audio peak**

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,pix_fmt -of json out/vina-sim-sample.mp4
ffmpeg -i out/vina-sim-sample.mp4 -af volumedetect -vn -sn -dn -f null NUL
```

Expected video fields: width `1080`, height `1920`, frame rate `30/1`, pixel format `yuv420p`. Expected audio: intelligible speech over music and maximum volume at or below `-1.0 dB`.

- [ ] **Step 5: Inspect representative frames**

```powershell
npx remotion still VinaSimMascotVideo out/vina-sim-frame-hook.png --frame=45
npx remotion still VinaSimMascotVideo out/vina-sim-frame-benefit.png --frame=450
npx remotion still VinaSimMascotVideo out/vina-sim-frame-close.png --frame=840
```

Check each image for mascot consistency, caption readability, source media quality, right-rail clearance, bottom clearance, and absence of visual CTA copy.

- [ ] **Step 6: Install the verified skill into the personal Gemini configuration**

Resolve and verify both absolute paths before copying:

```powershell
$sourceSkill = (Resolve-Path '.gemini\skills\vina-sim-mascot-video').Path
$destinationRoot = 'C:\Users\ADMIN\.gemini\config\skills'
$destinationSkill = Join-Path $destinationRoot 'vina-sim-mascot-video'
Write-Output "source=$sourceSkill"
Write-Output "destination=$destinationSkill"
if (-not $sourceSkill.StartsWith((Resolve-Path '.').Path)) { throw 'Source skill escaped the repository' }
New-Item -ItemType Directory -Force $destinationRoot | Out-Null
if (Test-Path -LiteralPath $destinationSkill) { throw 'Destination already exists; inspect it before replacing' }
Copy-Item -LiteralPath $sourceSkill -Destination $destinationSkill -Recurse
```

This is a non-destructive first install. If the destination exists, stop and compare it instead of overwriting it.

- [ ] **Step 7: Verify the installed package**

```powershell
Get-ChildItem -Recurse -File 'C:\Users\ADMIN\.gemini\config\skills\vina-sim-mascot-video' | Select-Object FullName,Length
python -m unittest tests.test_vina_sim_skill -v
```

Expected: `SKILL.md`, all five references, all three scripts, and `assets/simi-reference.png` are present.

- [ ] **Step 8: Commit any final verification-only source changes**

Do not commit files under `out/`. If source changes were required during verification:

```powershell
git add src/vina-sim .gemini/skills/vina-sim-mascot-video tools/vina_sim_pipeline.py tests package.json package-lock.json .gitignore src/Root.tsx
git commit -m "fix: complete Vina SIM skill verification"
```

If `git status --short` shows no relevant source changes, do not create an empty commit.
