"""本地逐页 OCR；没有引擎时明确失败，绝不调用云端识别。"""
from __future__ import annotations

import hashlib
import csv
import io
import json
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import config
from .text import normalize_text


class OCRUnavailable(RuntimeError):
    pass


_VISION_SOURCE = r'''
import Foundation
import Vision
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true
request.minimumTextHeight = 0.003
do {
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1]))
    try handler.perform([request])
    let observations = (request.results ?? []).enumerated().sorted { lhs, rhs in
        let left = lhs.element.boundingBox
        let right = rhs.element.boundingBox
        let leftRow = Int((left.midY * 1000).rounded())
        let rightRow = Int((right.midY * 1000).rounded())
        if leftRow != rightRow { return leftRow > rightRow }
        if left.minX != right.minX { return left.minX < right.minX }
        if left.midY != right.midY { return left.midY > right.midY }
        return lhs.offset < rhs.offset
    }.map { $0.element }
    let candidates = observations.compactMap { $0.topCandidates(1).first }
    let weight = candidates.reduce(0) { $0 + $1.string.count }
    let confidence = candidates.reduce(0.0) { $0 + Double($1.confidence) * Double($1.string.count) }
    let result: [String: Any] = ["text": candidates.map { $0.string }.joined(separator: "\n"),
        "confidence": weight > 0 ? confidence / Double(weight) : 0]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
} catch {
    FileHandle.standardError.write(Data("本地文字识别失败".utf8))
    exit(1)
}
'''


def cache_dir() -> Path:
    path = config.DATA_DIR / "ocr_cache"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)
    return path


def engine() -> tuple[str, str]:
    """返回经过本机能力检查的引擎；Linux 要求中文语言包。"""
    if platform.system() == "Darwin" and shutil.which("swiftc"):
        digest = hashlib.sha256(_VISION_SOURCE.encode()).hexdigest()[:16]
        binary = cache_dir() / f"vision-{digest}"
        if not binary.exists():
            source = cache_dir() / f"vision-{digest}.swift"
            source.write_text(_VISION_SOURCE)
            source.chmod(0o600)
            proc = subprocess.run(
                ["swiftc", "-O", str(source), "-o", str(binary),
                 "-module-cache-path", str(cache_dir() / "swift-modules")],
                capture_output=True, timeout=180,
            )
            if proc.returncode:
                raise OCRUnavailable("无法编译本机 Vision 识别工具，请检查 Xcode 命令行工具")
            binary.chmod(0o700)
        return "vision-v3", str(binary)
    executable = shutil.which("tesseract")
    if executable:
        proc = subprocess.run([executable, "--list-langs"], capture_output=True, timeout=10)
        languages = proc.stdout.decode(errors="replace").splitlines()
        if "chi_sim" in languages and "eng" in languages:
            return "tesseract-chi_sim-eng-v1", executable
    raise OCRUnavailable("未找到本地中文 OCR：macOS 请安装 Xcode 命令行工具；Linux 请安装 Tesseract 及 chi_sim、eng 语言包")


def recognize_page(path: Path, page: int, source_hash: str, backend: tuple[str, str]) -> dict:
    if page < 1 or len(source_hash) != 64 or any(c not in "0123456789abcdef" for c in source_hash):
        raise ValueError("OCR 页码或原件哈希无效")
    key = hashlib.sha256(f"{source_hash}|{page}|{backend[0]}|2400".encode()).hexdigest()
    cached = cache_dir() / f"{key}.json"
    if cached.exists():
        try:
            value = json.loads(cached.read_text())
            if isinstance(value.get("text"), str):
                return value
        except (ValueError, OSError):
            pass
    with tempfile.TemporaryDirectory(prefix="ocr-page-", dir=cache_dir()) as temporary:
        image = Path(temporary) / "page"
        proc = subprocess.run(
            ["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile",
             "-scale-to", "2400", "-png", str(path), str(image)],
            capture_output=True, timeout=45,
        )
        if proc.returncode:
            raise OCRUnavailable(f"第 {page} 页无法转换为本地识别图像")
        if backend[0].startswith("vision"):
            proc = subprocess.run([backend[1], str(image.with_suffix(".png"))], capture_output=True, timeout=45)
            if proc.returncode:
                raise OCRUnavailable(f"第 {page} 页本地识别失败")
            result = json.loads(proc.stdout)
        else:
            proc = subprocess.run([backend[1], str(image.with_suffix(".png")), "stdout", "-l", "chi_sim+eng", "tsv"], capture_output=True, timeout=60)
            if proc.returncode:
                raise OCRUnavailable(f"第 {page} 页本地识别失败")
            lines: dict[tuple, list[str]] = {}
            weighted = 0.0
            weight = 0
            for word in csv.DictReader(io.StringIO(proc.stdout.decode("utf-8", errors="replace")), delimiter="\t"):
                text = (word.get("text") or "").strip()
                confidence = float(word.get("conf") or "-1")
                if not text or confidence < 0:
                    continue
                key = tuple(word.get(field) for field in ("block_num", "par_num", "line_num"))
                lines.setdefault(key, []).append(text)
                weighted += confidence * len(text)
                weight += len(text)
            result = {"text": "\n".join(" ".join(words) for words in lines.values()), "confidence": weighted / (100 * weight) if weight else 0.0}
        result = {"text": normalize_text(result["text"]), "confidence": result.get("confidence"), "engine": backend[0]}
        scratch = Path(temporary) / "result.json"
        scratch.write_text(json.dumps(result, ensure_ascii=False))
        scratch.chmod(0o600)
        os.replace(scratch, cached)
        return result
