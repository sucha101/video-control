import os, sys, json, time, argparse
from pathlib import Path

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description="VieNeu-TTS Batch Worker")
    parser.add_argument("--config-file", required=True, help="Path to job tts config json")
    args = parser.parse_args()

    config_path = Path(args.config_file)
    if not config_path.exists():
        print(f"Error: Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        job = json.load(f)

    lines = job.get("lines", [])
    output_dir = Path(job.get("outputDir", "."))
    tts_root = Path(job.get("ttsRoot", r"D:\viet tts\VieNeu-TTS"))
    voice_name = job.get("voice", "tinhtri")

    if not lines:
        print("Error: No lines provided for TTS", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Setup Python import path for VieNeu-TTS
    if str(tts_root) not in sys.path:
        sys.path.append(str(tts_root))

    import torch
    import soundfile as sf
    from vieneu_tts import VieNeuTTS

    # Select voice sample
    sample_dir = tts_root / "sample"
    pt_file = sample_dir / f"{voice_name}.pt"
    txt_file = sample_dir / f"{voice_name}.txt"

    if not pt_file.exists():
        # Fallback to tinhtri
        print(f"Warning: Voice '{voice_name}' not found, falling back to 'tinhtri'")
        pt_file = sample_dir / "tinhtri.pt"
        txt_file = sample_dir / "tinhtri.txt"

    print(f"Loading VieNeu TTS model on CPU (voice: {pt_file.stem})...", flush=True)
    tts = VieNeuTTS(
        backbone_repo='pnnbao-ump/VieNeu-TTS-q4-gguf',
        backbone_device='cpu',
        codec_repo='neuphonic/neucodec-onnx-decoder',
        codec_device='cpu'
    )

    ref_codes = torch.load(pt_file, map_location='cpu')
    ref_text = txt_file.read_text(encoding='utf-8').strip()

    durations = {}
    print(f"Starting TTS generation for {len(lines)} lines...", flush=True)

    for i, line in enumerate(lines, 1):
        line_clean = line.strip()
        if not line_clean:
            continue
        start_t = time.time()
        audio = tts.infer(line_clean, ref_codes, ref_text)
        out_file = output_dir / f"vo_{i:02d}.wav"
        sf.write(out_file, audio, 24000)
        dur = round(len(audio) / 24000, 2)
        durations[str(i)] = dur
        print(f"[{i:02d}/{len(lines):02d}] ({dur}s) {line_clean[:40]}... in {time.time()-start_t:.1f}s", flush=True)

    # Save durations.json
    durations_file = output_dir / "durations.json"
    with open(durations_file, "w", encoding="utf-8") as f:
        json.dump(durations, f, indent=2, ensure_ascii=False)

    print(f"TTS completed successfully! Total duration: {round(sum(durations.values()), 2)}s", flush=True)

if __name__ == "__main__":
    main()
