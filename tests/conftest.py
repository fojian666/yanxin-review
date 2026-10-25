"""测试环境固定为「不联网」。

`load_dotenv` 不覆盖已存在的环境变量，所以在这里先写死，`rag.config` 读到的是关闭状态：
单测不该依赖外部 API，也不该因为本机有密钥就悄悄发请求出去。
需要验证向量链路的用例自己 monkeypatch `embedder`，不碰真实网络。
"""
import os

os.environ["EMBED_BACKEND"] = "none"
os.environ["ALLOW_EXTERNAL_EMBED"] = "0"
os.environ["ALLOW_EXTERNAL_LLM"] = "0"

# 模型相关变量也要清干净：本机 .env 里可能配了 DeepSeek，单测不该被它影响，
# 也不该在没授权的情况下发请求。
# 注意是「置空」而不是 pop——rag.config 里的 load_dotenv 会在导入时把 .env 再灌回
# environ，置空能让它跳过，pop 会被重新填回去。
for _name in (
    "LLM_PROVIDER",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_API_KEY",
    "QWEN_API_KEY",
    "DASHSCOPE_API_KEY",
    "QWEN_BASE_URL",
    "QWEN_MODEL",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
):
    os.environ[_name] = ""
