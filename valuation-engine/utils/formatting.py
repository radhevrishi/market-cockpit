"""Currency / number formatters."""


def fmt_inr(v: float | None) -> str:
    if v is None or v != v:
        return '—'
    if abs(v) >= 1e7:  return f'₹{v/1e7:.2f}Cr'
    if abs(v) >= 1e5:  return f'₹{v/1e5:.2f}L'
    if abs(v) >= 1e3:  return f'₹{v/1e3:.1f}k'
    return f'₹{v:.0f}'


def fmt_cr(v: float | None) -> str:
    if v is None or v != v:
        return '—'
    if abs(v) >= 1e5:  return f'₹{v/1e5:.2f}L Cr'
    if abs(v) >= 1e3:  return f'₹{v/1e3:.1f}k Cr'
    return f'₹{v:.0f} Cr'


def fmt_pct(v: float | None, decimals: int = 1) -> str:
    if v is None or v != v:
        return '—'
    return f'{v:+.{decimals}f}%' if v != 0 else '0%'


def fmt_x(v: float | None, decimals: int = 1) -> str:
    if v is None or v != v:
        return '—'
    return f'{v:.{decimals}f}×'
