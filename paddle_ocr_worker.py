#!/usr/bin/env python3
"""
Persistent PaddleOCR bridge for the Node delivery-management server.

Protocol: one JSON object per stdin line:
  {"id": 1, "image": "<base64>"}

Response:
  {"id": 1, "ok": true, "text": "..."}
or
  {"id": 1, "ok": false, "error": "..."}
"""
import base64
import json
import os
import sys
import tempfile

try:
    from paddleocr import PaddleOCR
except Exception as exc:
    print("IMPORT_ERROR: " + repr(exc), file=sys.stderr, flush=True)
    raise

# PP-OCRv5 is the current general OCR pipeline. Document orientation and
# unwarping are enabled to improve photographed/rotated bills.
ocr = PaddleOCR(
    use_doc_orientation_classify=True,
    use_doc_unwarping=True,
    use_textline_orientation=True,
    device=os.environ.get("PADDLE_OCR_DEVICE", "cpu"),
)

def result_to_text(result):
    data = getattr(result, "json", None)
    if callable(data):
        data = data()
    if not isinstance(data, dict):
        data = getattr(result, "res", None)
    if not isinstance(data, dict):
        return ""

    # PaddleOCR 3.x wraps the actual result under "res".
    if isinstance(data.get("res"), dict):
        data = data["res"]

    texts = data.get("rec_texts") or []
    boxes = data.get("rec_boxes") or []
    scores = data.get("rec_scores") or []

    rows = []
    for i, text in enumerate(texts):
        text = str(text or "").strip()
        if not text:
            continue
        box = boxes[i] if i < len(boxes) else None
        score = float(scores[i]) if i < len(scores) else 0.0
        x = y = 0.0
        if box is not None:
            try:
                x1, y1, x2, y2 = [float(v) for v in box]
                x = (x1 + x2) / 2.0
                y = (y1 + y2) / 2.0
            except Exception:
                pass
        rows.append((y, x, score, text))

    # Reconstruct reading order from detected boxes. A small vertical tolerance
    # keeps invoice columns on the same physical line instead of scattering them.
    rows.sort(key=lambda r: (r[0], r[1]))
    ordered = []
    current_y = None
    current = []
    for row in rows:
        y = row[0]
        if current_y is None or abs(y - current_y) <= max(12.0, abs(current_y) * 0.012):
            current.append(row)
            if current_y is None:
                current_y = y
        else:
            current.sort(key=lambda r: r[1])
            ordered.append(" ".join(r[3] for r in current))
            current = [row]
            current_y = y
    if current:
        current.sort(key=lambda r: r[1])
        ordered.append(" ".join(r[3] for r in current))

    return "\n".join(ordered)

def process(req):
    req_id = req.get("id")
    raw = base64.b64decode(req.get("image", ""))
    suffix = ".png"
    fd, path = tempfile.mkstemp(prefix="purchase-ocr-", suffix=suffix)
    os.close(fd)
    try:
        with open(path, "wb") as f:
            f.write(raw)
        outputs = ocr.predict(path)
        texts = []
        for result in outputs:
            text = result_to_text(result)
            if text:
                texts.append(text)
        return {"id": req_id, "ok": True, "text": "\n\n".join(texts)}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        print(json.dumps(process(req), ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({
            "id": req.get("id") if "req" in locals() and isinstance(req, dict) else None,
            "ok": False,
            "error": str(exc),
        }, ensure_ascii=False), flush=True)
