"""Use the same fixtures and local Q8 snapshot on each runtime."""
import argparse
import json
from pathlib import Path


def reference(model_dir, fixtures, output):
    import mlx.core as mx
    from mlx_embeddings import load

    mx.set_default_device(mx.gpu)
    mx.set_cache_limit(64 * 1024 * 1024)
    model, tokenizer = load(str(model_dir))
    vectors = []
    for text in json.loads(fixtures.read_text()):
        tokens = tokenizer(
            text, add_special_tokens=True, truncation=True, max_length=1024, return_tensors="mlx"
        )
        ids = tokens["input_ids"]
        result = model(ids, attention_mask=tokens["attention_mask"]).text_embeds[0]
        vectors.append({"tokens": ids[0].tolist(), "vector": result.astype(mx.float32).tolist()})
        print(f"Python fixture {len(vectors)}: {ids.shape[-1]} tokens", flush=True)
    output.write_text(json.dumps({"vectors": vectors, "peak": mx.get_peak_memory()}))


def compare(python_path, swift_path):
    import math

    python = json.loads(python_path.read_text())["vectors"]
    swift = json.loads(swift_path.read_text())
    successes = len(python) == len(swift["vectors"])
    for i, (expected, actual) in enumerate(zip(python, swift["vectors"]), 1):
        a, b = expected["vector"], actual["vector"]
        norm_a, norm_b = math.hypot(*a), math.hypot(*b)
        cosine = math.fsum(x * y for x, y in zip(a, b)) / (norm_a * norm_b)
        maximum_absolute_error = max(abs(x - y) for x, y in zip(a, b))
        identical_tokens = expected["tokens"] == actual["tokens"]
        print(f"{i}: tokens={len(actual['tokens'])}, identical={identical_tokens}, "
              f"dimensions={len(b)}, norm={norm_b:.7f}, cosine={cosine:.8f}, "
              f"max_abs_delta={maximum_absolute_error:.6f}, elapsed={actual['seconds']:.3f}s")
        if not identical_tokens:
            print("  Python:", expected["tokens"][:80])
            print("  Swift: ", actual["tokens"][:80])
        successes &= (identical_tokens and len(a) == len(b) == 2560
                      and abs(norm_a - 1) < 0.005 and abs(norm_b - 1) < 0.00001
                      and cosine >= 0.999)
    scores = [math.fsum(a * b for a, b in zip(swift["vectors"][0]["vector"], row["vector"]))
              for row in swift["vectors"][1:3]]
    print(f"related / unrelated cosine: {scores}")
    print(f"Swift load: {swift['loadSeconds']:.3f}s, MLX bytes: {swift['mlxMemory']}")
    if not successes or scores[0] <= scores[1]:
        raise SystemExit("Parity checks failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("reference")
    run.add_argument("model", type=Path)
    run.add_argument("fixtures", type=Path)
    run.add_argument("output", type=Path)
    check = commands.add_parser("compare")
    check.add_argument("python", type=Path)
    check.add_argument("swift", type=Path)
    args = parser.parse_args()
    if args.command == "reference":
        reference(args.model, args.fixtures, args.output)
    else:
        compare(args.python, args.swift)
