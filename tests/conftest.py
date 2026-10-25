"""测试环境固定为「不联网」。

`load_dotenv` 不覆盖已存在的环境变量，所以在这里先写死，`rag.config` 读到的是关闭状态：
单测不该依赖外部 API，也不该因为本机有密钥就悄悄发请求出去。
需要验证向量链路的用例自己 monkeypatch `embedder`，不碰真实网络。
"""
import os

os.environ["EMBED_BACKEND"] = "none"
os.environ["ALLOW_EXTERNAL_EMBED"] = "0"
os.environ["ALLOW_EXTERNAL_LLM"] = "0"
