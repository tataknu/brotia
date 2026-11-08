"""ApiError exceptions (CONTRACT §B errors). Raise these from routers (or builders) to get the
contract error body {error, detail} with the right status."""

from __future__ import annotations


class ApiException(Exception):
    def __init__(self, status: int, error: str, detail: str):
        super().__init__(detail)
        self.status = status
        self.error = error
        self.detail = detail


def invalid_request(detail: str) -> ApiException:
    return ApiException(400, "invalid_request", detail)


def bbox_too_large(detail: str) -> ApiException:
    return ApiException(400, "bbox_too_large", detail)


def not_found(detail: str) -> ApiException:
    return ApiException(404, "not_found", detail)


def no_api_key(detail: str = "ANTHROPIC_API_KEY is not set; the farming agent is unavailable") -> ApiException:
    return ApiException(503, "no_api_key", detail)


def internal_error(detail: str) -> ApiException:
    return ApiException(500, "internal_error", detail)
