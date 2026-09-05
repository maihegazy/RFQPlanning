"""Small HTTP helpers shared by the routers."""

import re
import unicodedata
from urllib.parse import quote

_UNSAFE_ASCII = re.compile(r'[\\/"\r\n\t]')


def attachment_disposition(filename: str) -> str:
    """A `Content-Disposition` value for a download named `filename`.

    HTTP headers are latin-1, so a name with an en dash, a euro sign or non-Latin
    letters cannot be sent as-is (Starlette raises, and the request fails with 500).
    RFC 6266 / RFC 5987 solve this with two parameters: a plain ASCII `filename`
    for old clients and a percent-encoded UTF-8 `filename*` that every current
    browser prefers. The ASCII fallback strips accents rather than dropping the
    letters, so "Zoë" degrades to "Zoe" instead of "Zo".
    """
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode()
    ascii_name = _UNSAFE_ASCII.sub("_", ascii_name).strip() or "download"
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"
