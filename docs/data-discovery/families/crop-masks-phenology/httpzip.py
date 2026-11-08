"""Tiny HTTP-range file object so zipfile can list/extract members of a remote zip without downloading it."""
import io, requests
class HttpFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos, self.s = url, 0, requests.Session()
        r = self.s.head(url, allow_redirects=True, timeout=60); self.url = r.url
        self.size = int(r.headers["Content-Length"]); self.bytes = 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.size, self.pos + n) - 1
        r = self.s.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120)
        b = r.content; self.pos += len(b); self.bytes += len(b); return b
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)
