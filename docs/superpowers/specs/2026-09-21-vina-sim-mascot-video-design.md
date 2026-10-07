# Vina SIM Mascot Video — Design Specification

**Date:** 2026-09-21

**Skill name:** `vina-sim-mascot-video`

**Primary brand:** VNPT Hà Tĩnh / VinaPhone
**Mascot:** Bé Simi

## 1. Purpose

`vina-sim-mascot-video` is an end-to-end workflow for researching, scripting, sourcing, producing, and validating 9:16 short-form sales videos for VinaPhone SIM packages. The videos are published by VNPT Hà Tĩnh and use Bé Simi as a consistent presenter.

The workflow must work in two modes:

1. **Specific-package mode:** the user provides a package code, URL, screenshot, or official package information, such as `U1500`.
2. **Discovery mode:** the user asks the skill to find a current, attractive, or noteworthy VinaPhone package and turn it into a video.

Every produced video targets the customer segment best matched to the verified package. The closing call to action is spoken aloud: **“Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.”** It is not displayed as a persistent bar or subtitle.

## 2. Goals

- Produce accurate, concise, trustworthy VinaPhone package videos.
- Automatically identify the customer segment, pain point, and strongest sales angle for each package.
- Choose among three adaptive script formats rather than reuse one rigid sales template.
- Research current packages without treating unverified third-party claims as product truth.
- Source usable footage and images with traceable provenance and usage rights.
- Keep Bé Simi, the brand language, captions, layout, and animation consistent across videos.
- Generate a render-ready Remotion composition and a browser preview.

## 3. Non-goals

- The skill does not promise package eligibility before a subscriber is checked.
- The skill does not publish content to social networks or answer customer inbox messages.
- The skill does not reuse third-party TikTok, Facebook, or YouTube content without permission.
- The skill does not infer missing prices, benefits, registration syntax, or validity periods.
- The skill does not claim that a package is “cheapest,” “best,” “strongest,” or “unlimited” without direct supporting evidence.

## 4. Character and Brand Direction

### 4.1 Bé Simi

Bé Simi is an anthropomorphic blue SIM card with an orange chip, rounded arms and legs, large eyes, and a simple smiling mouth. The attached user-selected illustration is the visual source of truth.

Production assets must redraw or isolate the mascot onto transparent backgrounds. Text, buttons, and page layout embedded in the reference image are not part of the mascot.

The production pack must support at least these reusable states:

- neutral host;
- greeting or waving;
- curious or evaluating;
- surprised by a pain point;
- explaining a benefit;
- pointing at price or allowance;
- warning about an eligibility condition;
- confident closing pose.

Bé Simi is lively, honest, concise, and helpful. The character behaves like a young advisor who recommends according to real needs and does not pressure the viewer to buy.

### 4.2 Voice

- Standard Vietnamese pronunciation.
- Young, clear, friendly, and moderately paced.
- Short sentences and everyday vocabulary.
- No exaggerated announcer delivery.
- Conditions and eligibility caveats receive the same clarity as headline benefits.

### 4.3 Visual identity

- Primary palette: VNPT/VinaPhone blues, white, and light aqua.
- Orange is reserved for emphasis, warnings, and small attention accents.
- Backgrounds are bright, clean, and softly dimensional rather than dark or visually noisy.
- A small VNPT Hà Tĩnh brand identifier may appear in the top safe zone.
- The mascot and essential facts stay outside the bottom 15% and the right-side TikTok control area.
- There is no persistent on-screen inbox bar, fake button, or on-screen inbox CTA.

## 5. System Architecture

The skill follows this data flow:

```text
User input
  → Input Router
  → Package Research and Verification
  → Audience Matcher
  → Creative Format Selector
  → Script and Scene Planner
  → Asset Planner and Rights Manifest
  → Voice, Captions, and Remotion Production
  → Quality Gates
  → Deliverables
```

Each component has one responsibility and passes structured data to the next component.

### 5.1 Input Router

The router classifies the request as:

- `specific_package`: a package code, page, screenshot, or fact sheet was supplied;
- `discover_package`: the user wants the workflow to select a package;
- `compare_packages`: multiple packages were supplied and the best sales candidate must be chosen.

The router preserves all user-provided material as evidence but does not automatically mark it as officially verified.

### 5.2 Package Research and Verification

This component creates a fact sheet from current evidence. Product claims must be checked during the current execution of the workflow.

Source priority:

1. Current official VinaPhone and VNPT product pages.
2. Official VNPT Hà Tĩnh material supplied by the user or published through an official channel.
3. Official registration pages or My VNPT information when accessible.
4. Third-party pages and social posts for discovery only.

A product claim is `verified` only when supported by an official source or user-provided material explicitly identified as official internal material. Conflicting official information produces `conflict`; missing material produces `incomplete`.

No video may proceed to final rendering while verification is `conflict` or `incomplete` for any central sales claim.

### 5.3 Discovery Scoring

In discovery mode, the workflow creates a shortlist and scores every candidate on a 100-point scale:

| Criterion | Weight |
| --- | ---: |
| Current validity and confidence | 25 |
| Benefit-to-price strength relative to candidates | 25 |
| Match to a clear customer segment | 20 |
| Clarity in a short video | 15 |
| Availability of suitable media | 10 |
| Timeliness or novelty | 5 |

The highest score is a recommendation, not proof that a package is broadly “hot.” The final report explains the score and avoids unsupported popularity claims.

## 6. Canonical Data Model

```ts
type VerificationStatus = "verified" | "conflict" | "incomplete";
type ScriptFormat =
  | "problem-solution"
  | "offer-breakdown"
  | "who-is-it-for";

interface PackageFact {
  code: string;
  name: string;
  priceVnd: number;
  cycleDays: number;
  dataAllowance: {
    amount: number;
    unit: "MB" | "GB";
    cadence: "total" | "daily" | "monthly";
    rollover?: boolean;
    afterCap?: string;
  };
  voiceAllowance?: {
    onNetMinutes?: number;
    offNetMinutes?: number;
    perCallLimitMinutes?: number;
  };
  smsAllowance?: number;
  appBenefits: string[];
  additionalBenefits: Array<{
    label: string;
    value: string;
    conditions: string[];
  }>;
  registrationMethod?: string;
  eligibility: string[];
  coverageArea: string[];
  renewalRules: string[];
}

interface EvidenceItem {
  sourceType: "official-web" | "official-local" | "official-app" | "user-official";
  title: string;
  url?: string;
  localPath?: string;
  checkedAt: string;
  supportedClaims: string[];
}

interface VerifiedPackage {
  package: PackageFact;
  verification: {
    status: VerificationStatus;
    checkedAt: string;
    evidence: EvidenceItem[];
    uncertainClaims: string[];
  };
}

interface AudienceStrategy {
  primarySegment: string;
  secondarySegments: string[];
  painPoint: string;
  typicalUse: string[];
  buyingObjection: string;
  reasonForMatch: string;
}

interface CreativeStrategy {
  format: ScriptFormat;
  hook: string;
  corePromise: string;
  proofPoints: string[];
  forbiddenClaims: string[];
  targetDurationSeconds: number;
}

interface AssetItem {
  sceneId: string;
  mediaType: "official-image" | "stock-video" | "stock-image" | "infographic" | "mascot";
  purpose: string;
  sourceUrl?: string;
  localPath?: string;
  licenseOrPermission: string;
  downloadedAt?: string;
}

interface VideoProject {
  product: VerifiedPackage;
  audience: AudienceStrategy;
  creative: CreativeStrategy;
  assets: AssetItem[];
  callToAction: {
    spokenText: "Inbox trực tiếp VNPT Hà Tĩnh để được kiểm tra ưu đãi và tư vấn đăng ký.";
    displayOnScreen: false;
  };
}
```

If a package uses benefits that cannot fit the fixed fields, they are stored as additional verified benefit entries rather than forced into an inaccurate category.

## 7. Audience Matching

The skill infers the primary segment from verified benefits and conditions. It does not begin with a fixed audience.

Examples of matching signals:

- High daily data and social/video benefits: students, young workers, creators, or entertainment-heavy users.
- Large off-net voice allowance: sales staff, service businesses, or frequent callers.
- Long validity period: users who value convenience, stable budgeting, or infrequent renewal.
- Restricted eligibility: the exact eligible group becomes the first filter, not a footnote.
- Local or regional conditions: viewers outside the applicable area are not targeted.

The matcher produces one primary segment, up to two secondary segments, one central pain point, and one buying objection. A single video speaks primarily to one segment.

## 8. Adaptive Script System

### 8.1 Problem–Solution

Use when the package resolves an obvious everyday problem.

```text
0–3s    Hook: the problem occurs
3–9s    Short real-life situation
9–18s   Bé Simi introduces the fitting solution
18–25s  Price, benefit, and important condition
25–30s  Bé Simi waves; spoken inbox CTA
```

### 8.2 Offer Breakdown

Use when verified numbers are the strongest reason to care.

```text
0–3s    Strongest verified number
3–9s    Data allowance in plain language
9–16s   Voice, SMS, or app benefits
16–24s  Eligibility and renewal conditions
24–30s  Spoken inbox CTA
```

### 8.3 Who Is It For?

Use when suitability and eligibility matter more than a headline number.

```text
0–4s    “Gói này hợp với ai?”
4–11s   Show up to three plausible profiles
11–19s  Bé Simi selects the best-matched profile
19–27s  Explain why and state the key caveat
27–33s  Spoken inbox CTA
```

### 8.4 Format selection rules

- Choose `problem-solution` when one pain point accounts for most of the package value.
- Choose `offer-breakdown` when price and allowances are simple, verified, and visually compelling.
- Choose `who-is-it-for` when eligibility is narrow, the package is easily misunderstood, or audience fit is the main sales argument.
- If two formats score equally, prefer `who-is-it-for` because it best supports honest consultation.

## 9. Asset Sourcing and Media Decisions

### 9.1 Approved asset sources

- Official VNPT, VinaPhone, or VNPT Hà Tĩnh product and brand material.
- User-provided footage and photography that VNPT Hà Tĩnh is authorized to use.
- Stock footage and photography with a usable license, such as Pexels or Pixabay, subject to a license check at acquisition time.
- Self-created infographics, icons, backgrounds, and Bé Simi assets.

### 9.2 Disallowed asset use

- Reposted TikTok, Facebook, or YouTube clips without permission.
- Media with a watermark that cannot be removed lawfully and cleanly.
- Low-resolution source media enlarged beyond acceptable quality.
- Screenshots that expose personal information or irrelevant account details.
- Third-party promotional art presented as official VNPT Hà Tĩnh material.

### 9.3 Video versus still images

Use video for movement, changing emotion, phone usage, travel, work, study, and other real-life situations. Clips should normally last 2–5 seconds.

Use still images or self-created infographics for price, allowance, registration method, eligibility, comparisons, and other information that must remain readable.

Every acquired asset is recorded in `asset-manifest.json` with its purpose, source, acquisition date, and license or permission basis.

## 10. Composition and Motion Design

- Canvas: 1080×1920.
- Frame rate: constant 30 fps.
- Typical duration: 25–35 seconds.
- Upper area: real-life footage, official product image, or infographic.
- Middle area: short caption pill containing 4–7 words.
- Lower-middle area: Bé Simi stage and expressive interaction.
- Bottom 15%: no essential information.
- Right-side interaction rail: no essential information.
- CTA: voice only; never a persistent banner, fake button, or CTA subtitle.
- Closing: Bé Simi waves, the voice says the CTA, and the video ends with a light brand resolve.

Animation is derived from Remotion frames using `spring`, `interpolate`, and deterministic math. CSS keyframes are not used for render-critical motion.

## 11. Voice and Caption Pipeline

1. Generate or record the approved Vietnamese voiceover.
2. Align speech at word level using Whisper or an equivalent aligner.
3. Group words into readable cues of 4–7 words.
4. Keep benefit and condition captions visible long enough to read.
5. Do not create an on-screen cue for the spoken inbox CTA.
6. Mix music below the voice and prevent clipping.

The target is clear mobile playback: speech remains dominant, background music is unobtrusive, and true peak does not exceed −1 dBTP.

## 12. Quality Gates and Error Handling

### 12.1 Fact gate

Pass only when price, cycle, core allowance, eligibility, and availability are verified. If official sources conflict, the workflow reports the conflict and stops before final scripting or rendering.

### 12.2 Claim gate

The script must distinguish confirmed benefits from interpretations. Comparative superlatives require direct evidence. Any sentence that could imply universal eligibility is rewritten.

### 12.3 Asset gate

Every external asset must have traceable provenance and an acceptable permission basis. Unavailable footage is replaced with licensed stock, an official still, or a self-created infographic; it is not replaced with an unauthorized repost.

### 12.4 Brand and layout gate

- Bé Simi remains recognizable across all scenes.
- Important text stays within the approved safe zones.
- The bottom 15% contains no essential information.
- No visual inbox CTA is present.
- Brand colors and typography remain consistent.

### 12.5 Technical gate

- Output resolution is 1080×1920.
- Output frame rate is CFR 30 fps.
- No missing frames, broken assets, caption overlaps, or clipped text.
- Voice is intelligible on phone speakers and is louder than music.
- Final MP4 and preview are both playable.

## 13. Deliverables

Each successful run produces:

- `package-facts.json`: verified product data and evidence;
- `audience-strategy.json`: target segment and reasoning;
- `creative-strategy.json`: chosen format, hook, proof points, and forbidden claims;
- `script.json`: voiceover and scene breakdown;
- `asset-manifest.json`: every source and usage basis;
- `captions.json`: aligned caption cues;
- a Remotion composition;
- a 1080×1920 MP4 render;
- an interactive or browser-playable preview;
- a short validation report listing passed gates and any non-blocking caveats.

If verification fails, the run produces a research report and evidence list instead of an advertisement video.

## 14. Acceptance Criteria

The design is successfully implemented when:

1. A user can provide a package code such as `U1500`, and the workflow verifies current facts before drafting claims.
2. A user can ask for a noteworthy current package, and the workflow returns a scored shortlist with a defensible recommendation.
3. The workflow identifies a primary audience and selects one of the three script formats using explicit rules.
4. Every external visual has a recorded source and usage basis.
5. Bé Simi appears consistently and uses the approved personality and voice direction.
6. The rendered video contains no visual inbox CTA and keeps essential content out of TikTok UI zones.
7. Conflicting or incomplete product facts stop the render instead of being guessed.
8. The final package includes the research, strategy, script, asset manifest, captions, MP4, preview, and validation report.
