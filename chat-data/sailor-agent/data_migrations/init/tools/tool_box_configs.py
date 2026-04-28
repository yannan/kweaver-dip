"""
内置工具箱配置
"""

from __future__ import annotations

from pathlib import Path

from config import settings

# 配置API和数据库连接信息
API_BASE_URL = "http://{host}:{port}/api/agent-operator-integration/internal-v1".format(
    host=settings.AGENT_OPERATOR_INTEGRATION_HOST,
    port=settings.AGENT_OPERATOR_INTEGRATION_PORT,
)

openapi_file_path = Path(__file__).parent / "openai"

_raw_tool_box_configs = [
    {
        "box_id": "78359920-25eb-4db5-91cb-5598e5db5542",
        "box_name": "数据分析员工具",
        "box_desc": "包含数据分析工具，支持意图理解、问数、找数等功能",
        "metadata_type": "openapi",
        "source": "custom",
        "config_version": "1.0.0",
        "config_source": "auto",
        "file_path": openapi_file_path / "data_analyst_tools.openapi.json",
        "content_type": "application/json",
    },
    {
        "box_id": "0a14ba57-5102-43a6-9836-f7be0fd44e48",
        "box_name": "数据理解工具箱",
        "box_desc": "数据理解 kweaver",
        "metadata_type": "openapi",
        "source": "custom",
        "config_version": "1.0.0",
        "config_source": "auto",
        "file_path": openapi_file_path / "data_understanding_toolbox.openapi.json",
        "content_type": "application/json",
    },
]


def _filter_existing_openapi_files(configs: list[dict]) -> list[dict]:
    """
    由于本次迁移不包含 `openapi/` 配置文件，为避免初始化阶段直接失败，
    这里在文件不存在时自动跳过对应工具箱配置。

    后续只要把 openapi 文件补齐（放到 `openapi_file_path` 目录下），配置会自动生效。
    """

    filtered: list[dict] = []
    for cfg in configs:
        file_path: Path = cfg.get("file_path")  # type: ignore[assignment]
        if isinstance(file_path, Path) and file_path.exists():
            filtered.append(cfg)
    return filtered


tool_box_configs = _filter_existing_openapi_files(_raw_tool_box_configs)

