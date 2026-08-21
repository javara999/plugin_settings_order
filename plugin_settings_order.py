# -*- coding: utf-8 -*-
from plugins.metadata.base import BaseMetadataProvider


PLUGIN_VERSION = "1.1.7"


class PluginSettingsOrderProvider(BaseMetadataProvider):
    id = "plugin_settings_order"
    name = "플러그인 설정 순서"
    version = PLUGIN_VERSION
    is_searchable = False
    config_schema = []

    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/javara999/plugin_settings_order/main",
        "files": [
            "plugin_settings_order.py",
            "__init__.py",
            "VERSION",
            "settings.html",
            "settings.css",
            "settings.js",
            "README.md",
        ],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": True,
    }

    def search(self, db_type, query):
        return []

    def apply(self, db_type, book_id, item_data):
        return False, "플러그인 설정 순서 플러그인은 메타데이터 적용 기능을 제공하지 않습니다."
