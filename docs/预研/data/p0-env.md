# P0 环境自检（sidecar 预研 · 阶段 B）

> 生成时间：2026-11-09T02:29:36.027Z
> 生成器：`tools/laya-sidecar/env-check.mjs`（三段：权重对拍 → 解释器探测 → 路线判定）

## ① 权重对拍

- 路径：`D:/<local-libs>/laya-multilingual/model.safetensors`
- 字节数：**643835514**（期望 643835514）⇒ ✅
- sha256：`9d628fd971b70038…`（期望前缀 `9d628fd9`）⇒ ✅

**对拍通过** ⇒ 继续探测解释器。

## ② 候选解释器探测

### 候选② · 本仓自建 venv

- 解释器：`D:/<repo>/.laya-venv/Scripts/python.exe`
- python：3.12.10
- laya：0.4.21
- `serve.create_app` 签名：`(router: Optional[Any] = None)`
- `laya.Router.__init__` 签名：`(self, models: Optional[Dict[str, str]] = None, device: Optional[str] = None, token: Optional[str] = None, revision: Optional[str] = None, revisions: Optional[Dict[str, Optional[str]]] = None, max_loaded: int = 2, default: str = 'multilingual', auto_task_detection: bool = False, standalone_repos: bool = False, preload: bool = False, lang_guess: Optional[Any] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, agent_kwargs: Optional[Dict[str, Any]] = None, sha256_digests: Optional[Dict[str, Optional[Dict[str, str]]]] = None)`
- `laya.load` 签名：`(model_id_or_path: str = 'convaiinnovations/laya', device: Optional[str] = None, token: Optional[str] = None, subfolder: Optional[str] = None, fast: bool = False, compile: bool = False, revision: Optional[str] = None, expected_sha256: Optional[Dict[str, str]] = None, lang_temperatures: Optional[Dict[str, Dict[str, Any]]] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, calibration: Optional[str] = None, backend: Optional[str] = None, onnx_path: Optional[str] = None, compile_warmup: bool = True, compile_cache: bool = False, compile_mode: str = 'default') -> Union[laya.agent.Agent, ForwardRef('ONNXAgent')]`
- torch：2.6.0+cu124
- torch 来源：`D:\<local-libs>\torch-cu124\torch\__init__.py`
- CUDA 可用：`true`

### 候选③ · 邻居仓 venv（跨项目耦合）

- 解释器：`D:/<other-repo>/experiments/venv/Scripts/python.exe`
- python：3.12.10
- laya：0.4.21
- `serve.create_app` 签名：`(router: Optional[Any] = None)`
- `laya.Router.__init__` 签名：`(self, models: Optional[Dict[str, str]] = None, device: Optional[str] = None, token: Optional[str] = None, revision: Optional[str] = None, revisions: Optional[Dict[str, Optional[str]]] = None, max_loaded: int = 2, default: str = 'multilingual', auto_task_detection: bool = False, standalone_repos: bool = False, preload: bool = False, lang_guess: Optional[Any] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, agent_kwargs: Optional[Dict[str, Any]] = None, sha256_digests: Optional[Dict[str, Optional[Dict[str, str]]]] = None)`
- `laya.load` 签名：`(model_id_or_path: str = 'convaiinnovations/laya', device: Optional[str] = None, token: Optional[str] = None, subfolder: Optional[str] = None, fast: bool = False, compile: bool = False, revision: Optional[str] = None, expected_sha256: Optional[Dict[str, str]] = None, lang_temperatures: Optional[Dict[str, Dict[str, Any]]] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, calibration: Optional[str] = None, backend: Optional[str] = None, onnx_path: Optional[str] = None, compile_warmup: bool = True, compile_cache: bool = False, compile_mode: str = 'default') -> Union[laya.agent.Agent, ForwardRef('ONNXAgent')]`
- torch：2.6.0+cu124
- torch 来源：`D:\<other-repo>\experiments\venv\Lib\site-packages\torch\__init__.py`
- CUDA 可用：`true`

## ③ 路线判定

- 采用环境：`D:/<repo>/.laya-venv/Scripts/python.exe`（候选② · 本仓自建 venv）
- A 路判据（create_app 首参接受 router/agent **且** Router 签名含本地目录/缓存路径参数）：`true`
  - create_app：`(router: Optional[Any] = None)`
  - Router.__init__：`(self, models: Optional[Dict[str, str]] = None, device: Optional[str] = None, token: Optional[str] = None, revision: Optional[str] = None, revisions: Optional[Dict[str, Optional[str]]] = None, max_loaded: int = 2, default: str = 'multilingual', auto_task_detection: bool = False, standalone_repos: bool = False, preload: bool = False, lang_guess: Optional[Any] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, agent_kwargs: Optional[Dict[str, Any]] = None, sha256_digests: Optional[Dict[str, Optional[Dict[str, str]]]] = None)`
- B 路判据（`laya.load` 能返回可用推理对象）：`true`
  - load：`(model_id_or_path: str = 'convaiinnovations/laya', device: Optional[str] = None, token: Optional[str] = None, subfolder: Optional[str] = None, fast: bool = False, compile: bool = False, revision: Optional[str] = None, expected_sha256: Optional[Dict[str, str]] = None, lang_temperatures: Optional[Dict[str, Dict[str, Any]]] = None, hooks=None, on_predict_start=None, on_predict_end=None, hooks_raise: bool = True, hooks_concurrent: bool = True, hooks_timeout: Optional[float] = None, calibration: Optional[str] = None, backend: Optional[str] = None, onnx_path: Optional[str] = None, compile_warmup: bool = True, compile_cache: bool = False, compile_mode: str = 'default') -> Union[laya.agent.Agent, ForwardRef('ONNXAgent')]`
- **launch 路线 = A**（官方 app 指向本地权重）

## 结论

采用环境=`D:/<repo>/.laya-venv/Scripts/python.exe`
torch来源=`D:\<local-libs>\torch-cu124\torch\__init__.py`
CUDA可用=`true`
launch路线=`A`
