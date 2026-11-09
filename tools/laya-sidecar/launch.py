# Laya sidecar 启动器（sidecar 预研 · 阶段 B · Task 12）。
#
# ⚠️ **硬性要求（逐条落地，不得放宽）**：
#   ① `HOST` **硬编码** `"127.0.0.1"` —— 不接受任何环境变量改绑定（防误暴露到局域网）。
#   ② `PORT` 只从 `LAYA_SERVE_PORT` 取，默认 8712（避开 GateKeeper 的 8000）。
#   ③ 进程内设置 `USE_TF=0` / `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` / `HF_HOME=D:\<local-libs>\hf-home`
#      ⇒ 断网也能跑，且**不会**去 HuggingFace 拉权重（离线承诺）。
#   ④ 参数名照 P0 实测的真实签名写：`Router(models=..., device=..., default=...)`（`models` 是
#      **模型名 → 本地路径**的映射 ⇒ 这就是「官方 app 指向本地权重」的 A 路机制）。
#
# 权重目录：`LAYA_WEIGHT_DIR`（默认 `D:\<local-libs>\laya-multilingual`）。
# 端口与权重目录都**打印到 stderr** ⇒ 编排脚本与人工都能看到实际取值。

import os

# ⚠️ ③ 必须在 import laya **之前**设置（transformers 在导入期读这些变量决定是否联网）。
os.environ['USE_TF'] = '0'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HOME'] = os.environ.get('LAYA_HF_HOME', r'D:\<local-libs>\hf-home')

import sys
import time
from pathlib import Path

from laya import Router
from laya.serve import create_app

# ⚠️ ① 硬绑环回（不接受环境变量覆盖）。
HOST = "127.0.0.1"
PORT = int(os.environ.get("LAYA_SERVE_PORT", "8712"))

WEIGHT_DIR = Path(os.environ.get('LAYA_WEIGHT_DIR', r'D:\<local-libs>\laya-multilingual'))


def cuda_available() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def main() -> int:
    t0 = time.perf_counter()
    weight = WEIGHT_DIR / 'model.safetensors'
    if not weight.exists():
        print(f'[launch] 权重不存在：{weight}', file=sys.stderr)
        return 1
    device = 'cuda' if cuda_available() else 'cpu'
    # ⚠️ ④ 参数名照 P0 实测签名：Router(models: Dict[str, str], device, ..., default: str)
    router = Router(
        models={'multilingual': str(WEIGHT_DIR)},
        device=device,
        default='multilingual',
    )
    app = create_app(router)
    print(
        f'[launch] 权重目录={WEIGHT_DIR} device={device} 默认模型=multilingual '
        f'⇒ 准备起 {HOST}:{PORT}（准备耗时 {time.perf_counter() - t0:.2f}s）',
        file=sys.stderr, flush=True,
    )
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level='info')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
