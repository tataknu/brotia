"""Thin HTTP routers (CONTRACT §B). Each endpoint validates the request, then calls one function in the
owning builder package via app.routers.dispatch. Kept empty to avoid import cycles."""
