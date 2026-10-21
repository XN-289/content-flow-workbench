import argparse
import json
import sys
import wave
from pathlib import Path


def format_timestamp(value: float) -> str:
    total_seconds = int(value)
    milliseconds = int(round((value - total_seconds) * 1000))
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def read_wav_mono_16k(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getframerate() != 16000:
            raise SystemExit("Expected a 16 kHz mono WAV; run ffmpeg first")
        if handle.getsampwidth() != 2:
            raise SystemExit("Expected 16-bit PCM WAV")
        pcm = handle.readframes(handle.getnframes())

    return np.frombuffer(pcm, dtype=np.int16).astype("float32") / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--package-dir", default="")
    args = parser.parse_args()

    if args.package_dir:
        sys.path.insert(0, args.package_dir)

    from faster_whisper import WhisperModel

    media_path = Path(args.media)
    output_path = Path(args.output)
    audio = read_wav_mono_16k(media_path)
    model = WhisperModel(
        str(Path(args.model_path)),
        device="cpu",
        compute_type="int8",
        cpu_threads=4,
        local_files_only=True,
    )
    segments, info = model.transcribe(
        audio,
        language="zh",
        task="transcribe",
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt="以下是普通话的简体中文逐字稿。",
    )
    rows = []
    text_parts = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        rows.append({
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "startTimestamp": format_timestamp(segment.start),
            "endTimestamp": format_timestamp(segment.end),
            "text": text,
        })
        text_parts.append(text)

    result = {
        "media": str(media_path),
        "model": args.model_label,
        "detectedLanguage": info.language,
        "detectedLanguageProbability": info.language_probability,
        "durationSeconds": round(info.duration, 3),
        "segmentCount": len(rows),
        "transcript": "\n".join(text_parts),
        "segments": rows,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "language": info.language,
        "durationSeconds": result["durationSeconds"],
        "segmentCount": result["segmentCount"],
        "transcriptPreview": result["transcript"][:500],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
