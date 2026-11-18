import os

import pygit2


def disable_symlinks(repo):
    if os.name != "nt":
        return
    try:
        repo.config["core.symlinks"] = False
    except Exception:
        pass


def read_global_http_proxy():
    try:
        cfg = pygit2.Config.get_global_config()
    except Exception:
        return None
    try:
        value = cfg["http.proxy"]
    except (KeyError, Exception):
        return None
    return value or None


def harden_pygit2_config():
    proxy = read_global_http_proxy()
    try:
        from pygit2.enums import ConfigLevel
        levels = [ConfigLevel.SYSTEM, ConfigLevel.XDG, ConfigLevel.GLOBAL]
    except (ImportError, AttributeError):
        levels = [
            pygit2.GIT_CONFIG_LEVEL_SYSTEM,
            pygit2.GIT_CONFIG_LEVEL_XDG,
            pygit2.GIT_CONFIG_LEVEL_GLOBAL,
        ]
    for level in levels:
        try:
            pygit2.settings.search_path[level] = ""
        except Exception:
            pass
    return proxy
