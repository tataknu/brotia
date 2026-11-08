"""Minimal NetCDF-3 classic / 64-bit-offset header parser (no dependencies).

Used for CR2MET point reads over HTTP Range: we fetch the header once, compute the byte offset of
each (time, lat, lon) value of a fixed-size variable, and request only those bytes. Spec:
https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any

NC_DIMENSION, NC_VARIABLE, NC_ATTRIBUTE = 0x0A, 0x0B, 0x0C
_TYPES = {1: ("b", 1), 2: ("c", 1), 3: ("h", 2), 4: ("i", 4), 5: ("f", 4), 6: ("d", 8)}


class HeaderTruncated(Exception):
    """The buffer ended before the header did; fetch more bytes and retry."""


@dataclass
class Var:
    name: str
    dims: list[str]
    shape: list[int]
    nc_type: int
    vsize: int
    begin: int
    attrs: dict[str, Any] = field(default_factory=dict)
    is_record: bool = False

    @property
    def itemsize(self) -> int:
        return _TYPES[self.nc_type][1]

    @property
    def fmt(self) -> str:
        return ">" + _TYPES[self.nc_type][0]

    def offset(self, index: tuple[int, ...]) -> int:
        """Byte offset of one element of a fixed-size (non-record) variable, C order."""
        if self.is_record:
            raise ValueError("record variables not supported")
        off, stride = 0, self.itemsize
        for i, n in zip(reversed(index), reversed(self.shape)):
            if not 0 <= i < n:
                raise IndexError(f"{self.name}: index {index} out of shape {self.shape}")
            off += i * stride
            stride *= n
        return self.begin + off

    def decode(self, raw: bytes) -> float | None:
        """Unpack one raw element, apply missing_value/_FillValue and scale_factor/add_offset."""
        (v,) = struct.unpack(self.fmt, raw)
        for k in ("missing_value", "_FillValue"):
            mv = self.attrs.get(k)
            if mv is not None:
                mv0 = mv[0] if isinstance(mv, (list, tuple)) else mv
                if v == mv0:
                    return None
        if self.nc_type in (5, 6) and v != v:  # NaN
            return None
        sf = self.attrs.get("scale_factor")
        ao = self.attrs.get("add_offset")
        sf = (sf[0] if isinstance(sf, (list, tuple)) else sf) if sf is not None else 1.0
        ao = (ao[0] if isinstance(ao, (list, tuple)) else ao) if ao is not None else 0.0
        return float(v) * float(sf) + float(ao)


@dataclass
class Header:
    version: int
    numrecs: int
    dims: dict[str, int]
    attrs: dict[str, Any]
    vars: dict[str, Var]
    size: int  # header length in bytes


class _R:
    def __init__(self, buf: bytes):
        self.b, self.p = buf, 0

    def take(self, n: int) -> bytes:
        if self.p + n > len(self.b):
            raise HeaderTruncated(f"need {self.p + n} bytes, have {len(self.b)}")
        out = self.b[self.p:self.p + n]
        self.p += n
        return out

    def i4(self) -> int:
        return struct.unpack(">i", self.take(4))[0]

    def u8(self) -> int:
        return struct.unpack(">q", self.take(8))[0]

    def name(self) -> str:
        n = self.i4()
        s = self.take(n).decode("utf-8", errors="replace")
        self.take((4 - n % 4) % 4)
        return s

    def values(self, nc_type: int, n: int) -> Any:
        code, size = _TYPES[nc_type]
        raw = self.take(n * size)
        self.take((4 - (n * size) % 4) % 4)
        if nc_type == 2:
            return raw.rstrip(b"\x00").decode("utf-8", errors="replace")
        vals = list(struct.unpack(">" + code * n, raw))
        return vals[0] if n == 1 else vals

    def attr_list(self) -> dict[str, Any]:
        tag, n = self.i4(), self.i4()
        if tag == 0 and n == 0:
            return {}
        if tag != NC_ATTRIBUTE:
            raise ValueError(f"bad attribute tag {tag}")
        out = {}
        for _ in range(n):
            nm = self.name()
            t = self.i4()
            cnt = self.i4()
            out[nm] = self.values(t, cnt)
        return out


def parse_header(buf: bytes) -> Header:
    r = _R(buf)
    magic = r.take(4)
    if magic[:3] != b"CDF" or magic[3] not in (1, 2):
        raise ValueError(f"not a NetCDF-3 classic file (magic {magic!r})")
    version = magic[3]
    numrecs = r.i4()
    dims: dict[str, int] = {}
    dim_names: list[str] = []
    tag, n = r.i4(), r.i4()
    if not (tag == 0 and n == 0):
        if tag != NC_DIMENSION:
            raise ValueError(f"bad dimension tag {tag}")
        for _ in range(n):
            nm = r.name()
            dims[nm] = r.i4()
            dim_names.append(nm)
    gatts = r.attr_list()
    vars_: dict[str, Var] = {}
    tag, n = r.i4(), r.i4()
    if not (tag == 0 and n == 0):
        if tag != NC_VARIABLE:
            raise ValueError(f"bad variable tag {tag}")
        for _ in range(n):
            nm = r.name()
            nd = r.i4()
            ids = [r.i4() for _ in range(nd)]
            atts = r.attr_list()
            t = r.i4()
            vsize = r.i4()
            begin = r.i4() if version == 1 else r.u8()
            names = [dim_names[i] for i in ids]
            shape = [dims[d] for d in names]
            is_rec = bool(shape) and shape[0] == 0
            vars_[nm] = Var(nm, names, shape, t, vsize, begin, atts, is_rec)
    return Header(version, numrecs, dims, gatts, vars_, r.p)
