# Laya sidecar 启动器（sidecar 预研 · 阶段 B · Task 12 Step 1）。
#
# ⚠️ **硬性要求（逐条落地，不得放宽）**：
#   ① `HOST` **硬编码** `"127.0.0.1"` —— 不接受任何环境变量改绑定（防误暴露到局域网）。
#   ② `PORT` 只从 `LAYA_SERVE_PORT` 取，默认 8712（避开 GateKeeper 的 8000）。
#   ③ 进程内设置 `USE_TF=0` / `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` / `HF_HOME=D:\<local-libs>\hf-home`
#      ⇒ 断网也能跑，且**不会**去 HuggingFace 拉权重。
#   ④ 参数名照 P0 实测的真实签名写（`Router(models=..., device=...)` / `load(model_id_or_path=...)`），
#      **不得**照抄计划里的占位参数名。
#
# 权重指向：`models={'multilingual': <本地 model.safetensors 目录>}`。

import os

# ⚠️ ③ 必须在 import laya **之前**设置（transformers 读这些变量决定是否联网）。
os.environ['USE_TF'] = '0'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HOME'] = r'D:\<local-libs>\hf-home'

import sys

from pathlib import Path

from laya import Router
from laya.serve import create_app

# ⚠️ ① 硬绑环回（不接受环境变量覆盖）。
HOST = "127.0.0.1"
PORT = int(os.environ.get("LAYA_SERVE_PORT", "8712"))

# 权重目录（由 P0 对拍确认的本地副本）。
WEIGHT_DIR = Path(r'D:\<local-libs>\laya-multilingual')


def main() -> int:
    weight = WEIGHT_DIR / 'model.safetensors'
    if not weight.exists():
        print(f'[launch] 权重不存在：{weight}', file=sys.stderr)
        return 1
    # ⚠️ ④ 参数名照 P0 实测签名：Router(models: Dict[str, str], device: Optional[str], ...)
    router = Router(
        models={'multilingual': str(WEIGHT_DIR)},
        device='cuda' if _cuda() else 'cpu',
        default='multilingual',
    )
    app = create_app(router)
    print(f'[launch] 权重={WEIGHT_DIR} device={router_device(router)} ⇒ 起 {HOST}:{PORT}', flush=True)
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level='info')
    return 0


def _cuda() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def router_device(router) -> str:
    return str(getattr(router, 'device', 'unknown'))


if __name__ == '__main__':
    raise SystemExit(main())
