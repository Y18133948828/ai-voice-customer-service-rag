"""第二阶段文字 Agent 的本地配置。密钥只从同目录 .env 读取。"""

import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))


class Config:
    VIKING_API_KEY = os.getenv("VIKING_API_KEY", "").strip()
    KB_COLLECTION_NAME = os.getenv("KB_COLLECTION_NAME", "AI_kefu").strip()
    KB_PROJECT_NAME = os.getenv("KB_PROJECT_NAME", "default").strip()
    KB_RESOURCE_ID = os.getenv("KB_RESOURCE_ID", "").strip()

    ARK_API_KEY = os.getenv("ARK_API_KEY", "").strip()
    ARK_MODEL = os.getenv("ARK_MODEL", "doubao-seed-2-1-turbo-260628").strip()
    AGENT_API_KEY = os.getenv("AGENT_API_KEY", "").strip()
    RTC_EVENT_SECRET = os.getenv("RTC_EVENT_SECRET", "").strip()


settings = Config()
