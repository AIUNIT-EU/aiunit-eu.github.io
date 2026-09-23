# Lokale Spracherkennung – eingebundene Fremddateien

Erzeugt mit `scripts/vendor-whisper.sh` am 2026-09-22. Kein CDN, kein Hub-Zugriff zur Laufzeit.

| Bestandteil | Version | Lizenz |
|---|---|---|
| @huggingface/transformers (transformers.min.js) | 4.3.0 | Apache-2.0 |
| onnxruntime-web (Asyncify-WASM) | 1.31.0-dev.20260914-8d85527a0 | MIT |
| onnx-community/whisper-base (quantisiert) | Revision 1846881b6b3a3024392c1eea3ad983695bc23925 | MIT (OpenAI Whisper) |

## SHA-256

```
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  transformers/LICENSE-transformers.js.txt
0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611  transformers/ort-wasm-simd-threaded.asyncify.mjs
49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082  transformers/ort-wasm-simd-threaded.asyncify.wasm
1475fd440e9932ab206682ee42cb18f6097403e9ee77ea62084c592d0f83597d  transformers/transformers.min.js
b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d  whisper/whisper-base/LICENSE-whisper.txt
9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1  whisper/whisper-base/added_tokens.json
f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b  whisper/whisper-base/config.json
61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0  whisper/whisper-base/generation_config.json
2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6  whisper/whisper-base/merges.txt
bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd  whisper/whisper-base/normalizer.json
fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b  whisper/whisper-base/onnx/decoder_model_merged_quantized.onnx
5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46  whisper/whisper-base/onnx/encoder_model_quantized.onnx
a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d  whisper/whisper-base/preprocessor_config.json
e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691  whisper/whisper-base/special_tokens_map.json
27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566  whisper/whisper-base/tokenizer.json
2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573  whisper/whisper-base/tokenizer_config.json
50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a  whisper/whisper-base/vocab.json
```
