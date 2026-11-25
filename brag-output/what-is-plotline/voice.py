# Voices narration.json with Kokoro (an open-source neural TTS, run locally; installed outside the repo, see plan.md).
#   ~/.local/share/plotline-tts/venv/bin/python brag-output/what-is-plotline/voice.py [voice] [outDir] [speed]
# Defaults: af_heart (the user's choice, 2026-11-25), rec/voice, 1.0. Writes one WAV per line (hookA.wav, hookB.wav,
# intro1.wav, ...), durations.json (seconds per line), and preview.wav: hook A and every line in order with a short
# gap, to listen to the whole script at once.
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.dirname(os.path.abspath(__file__))
voice = sys.argv[1] if len(sys.argv) > 1 else 'af_heart'
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'rec', 'voice')
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
models = os.path.expanduser('~/.local/share/plotline-tts/models')
kokoro = Kokoro(f'{models}/kokoro-v1.0.onnx', f'{models}/voices-v1.0.bin')

with open(f'{here}/narration.json', encoding='utf-8') as f:
    script = json.load(f)
lines = [('hookA', script['hooks']['A']['say']), ('hookB', script['hooks']['B']['say'])] + [(line['id'], line['say']) for line in script['lines']]

os.makedirs(out, exist_ok=True)
durations, parts, rate = {}, [], 24000
for line_id, text in lines:
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang='en-us')
    # Trim the model's leading and trailing near-silence so the timeline controls every pause.
    loud = np.where(np.abs(samples) > 0.004)[0]
    if len(loud):
        samples = samples[max(0, loud[0] - int(0.03 * rate)):loud[-1] + int(0.08 * rate)]
    sf.write(f'{out}/{line_id}.wav', samples, rate)
    durations[line_id] = round(len(samples) / rate, 3)
    if line_id != 'hookB':
        parts += [samples, np.zeros(int(0.45 * rate), dtype=samples.dtype)]
    print(f'{line_id:10s} {durations[line_id]:5.2f}s')

sf.write(f'{out}/preview.wav', np.concatenate(parts), rate)
with open(f'{out}/durations.json', 'w', encoding='utf-8') as f:
    json.dump({'voice': voice, 'speed': speed, 'seconds': durations}, f, indent=2)
print(f'total speech {sum(durations.values()):.1f}s, preview {sum(len(p) for p in parts) / rate:.1f}s')
