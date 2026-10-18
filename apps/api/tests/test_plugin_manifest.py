"""The frontend manifests and the backend catalog agree (M10 §7)."""

from fastapi import FastAPI

from semestra.modules.plugins import catalog


def test_every_web_plugin_is_registered_on_the_backend_and_kinds_match(app: FastAPI):
    # The app fixture has imported every module, so every plugin has registered itself.
    del app
    web = {m["id"]: m for m in catalog.load_web_manifest(catalog.WEB_MANIFEST_DEFAULT)}
    registered = catalog.registered_plugins()
    plugins = {mid for mid, m in web.items() if m["kind"] == "plugin"}
    missing = plugins - set(registered)
    assert not missing, f"plugins without register_plugin(PluginInfo(...)): {sorted(missing)}"
    for pid, info in registered.items():
        assert pid in web, f"{pid} is registered on the backend but has no frontend manifest"
        assert info.kind == web[pid]["kind"], f"{pid}: kind differs between frontend and backend"


def test_web_manifest_cards_are_consistent():
    for m in catalog.load_web_manifest(catalog.WEB_MANIFEST_DEFAULT):
        for card in m["cards"]:
            assert card["default_size"] in card["sizes"], card["id"]
            assert set(card["sizes"]) <= set(catalog.SIZE_SPANS), card["id"]
            assert set(card["scopes"]) <= set(catalog.BOARD_SCOPES), card["id"]
