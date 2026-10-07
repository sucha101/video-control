# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Design assumption only, not yet confirmed for implementation: serve a small mobile-first web interface from the existing Cloudflare Worker, using static HTML/CSS/JavaScript. The project currently has no web app scaffold. This recommendation reuses its deployment and API boundary; confirm before implementation.

## Users

The owner and one collaborator share a video-story production workflow. They may enter and review scripts from a phone; the owner runs the local production computer and works with Codex to create the video.

## Product Purpose

Collect video requests, preserve their selected production skill, show progress and results, and let an authorized user review and schedule or submit publication.

## Positioning

The web stores and coordinates work. Codex remains the human-invoked producer: after the user requests it in chat, Codex reads the request and follows its selected local skill, then returns video and posting materials to the web workflow.

## Operating Context

The existing Cloudflare Worker and durable queue are online. Remotion, VieNeu-TTS, and skill files run from the owner's Windows computer, which must be on for production. Google Drive stores completed MP4 files, Google Sheets is a tracking copy, and Buffer is the publication service. A collaborator can submit work while the owner's computer is offline; Codex only begins production after the owner asks it to process waiting requests.

## Capabilities and Constraints

- Two private user accounts: owner and collaborator; no public sign-up.
- A request includes title, script, one of the two configured skills (`viet-tiktok-story-video`, `drama-mascot-video`), and optional production details.
- Users inspect the production state, watch the MP4, edit caption/hashtags, and explicitly review before choosing channels and a posting time.
- Production and publication are separate states. Buffer acceptance or scheduling is distinct from a post confirmed as published.
- Publishing runs on the local computer when online. Uncertain provider outcomes require review and must not be retried blindly.
- No logo, existing brand palette, or user-supplied visual asset has been provided. The user asked Codex to propose a visual identity; it remains subject to review.
- Stack is an open decision. For design exploration only, assume static web assets served by the existing Worker; do not treat that assumption as implementation approval.

## Evidence on Hand

An existing V001 MP4, Drive file, Google Sheet record, and Buffer publication receipts demonstrate that one video has been produced and submitted to the three configured channels. They do not prove that a new web interface or unattended end-to-end automation has been delivered.

## Product Principles

- Make the next human action clear at every stage.
- Let the user choose the production skill for each script.
- Keep production, review, scheduling, and confirmed publication visibly distinct.
- Preserve work across network failures and when the local production computer is offline.
- Never retry an uncertain publication as if it definitely failed.
